"""Vendite, incassi, rimborsi, chiusure giornaliere."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from .. import db
from ..common import ZERO, D, now, parse_ts, q2, q4, q6, setting, split_vat
from ..http import ApiError, bad, conflict
from . import recipes, stock


def _distribute(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Ripartisce un importo in centesimi proporzionalmente ai pesi, senza errori di arrotondamento."""
    s = sum(weights)
    if total == 0 or s == 0:
        return [ZERO] * len(weights)
    raw = [total * w / s for w in weights]
    out = [q2(r) for r in raw]
    diff = q2(total - sum(out))
    i = 0
    step = Decimal("0.01") if diff > 0 else Decimal("-0.01")
    order = sorted(range(len(weights)), key=lambda k: -weights[k])
    while diff != 0 and order:
        out[order[i % len(order)]] += step
        diff -= step
        i += 1
    return out


def check_day_open(c: db.Cursor, business_date: dt.date, perms: set[str]):
    if c.val("SELECT 1 FROM day_closures WHERE business_date=%s", [business_date]) and \
            setting(c, "lock_closed_days", True) and "sales.void" not in perms:
        raise conflict(f"La giornata del {business_date.strftime('%d/%m/%Y')} è già chiusa")


def create_sale(c: db.Cursor, uid: int | None, perms: set[str], data: dict) -> dict:
    """data: sold_at, channel_id, mode, lines[{product_id|description, qty, unit_price, discount, vat_rate}],
       discount (sconto sul totale, IVA incl.), payments[{method_id, amount, pending}], commission, notes"""
    sold_at = parse_ts(data.get("sold_at")) or now()
    bdate = sold_at.date()
    check_day_open(c, bdate, perms)
    ch = c.one("SELECT * FROM sales_channels WHERE id=%s", [data.get("channel_id")])
    if not ch:
        raise bad("Canale di vendita non valido")
    mode = data.get("mode") or "analitica"
    in_lines = data.get("lines") or []
    if not in_lines:
        raise bad("Inserisci almeno un prodotto o un importo")

    default_vat = D(setting(c, "default_sale_vat_rate", 10))
    rows = []
    for ln in in_lines:
        qty = q4(ln.get("qty") or 1)
        if qty <= 0:
            raise bad("La quantità deve essere maggiore di zero")
        product = None
        if mode == "analitica":
            product = c.one("SELECT * FROM products WHERE id=%s", [ln.get("product_id")])
            if not product:
                raise bad("Prodotto non valido")
            price = q2(ln["unit_price"]) if ln.get("unit_price") not in (None, "") else D(product["sale_price"])
            vat = D(product["vat_rate"])
            desc = product["name"]
        else:
            price = q2(ln.get("unit_price") or ln.get("amount") or 0)
            vat = D(ln.get("vat_rate") if ln.get("vat_rate") not in (None, "") else default_vat)
            desc = ln.get("description") or "Incasso giornaliero (riepilogo)"
        if price < 0:
            raise bad("Il prezzo non può essere negativo")
        disc = q2(ln.get("discount") or 0)
        full = q2(qty * price)
        if disc < 0 or disc > full:
            raise bad("Sconto di riga non valido")
        rows.append({"product": product, "qty": qty, "price": price, "vat": vat, "desc": desc,
                     "full": full, "disc": disc})

    cart_disc = q2(data.get("discount") or 0)
    after_line = [r["full"] - r["disc"] for r in rows]
    if cart_disc < 0 or cart_disc > sum(after_line):
        raise bad("Sconto non valido")
    for r, extra in zip(rows, _distribute(cart_disc, after_line)):
        r["disc"] += extra
        r["total"] = r["full"] - r["disc"]
        r["net"], r["vatamt"] = split_vat(r["total"], r["vat"])

    gross_before = sum(r["full"] for r in rows)
    disc_total = sum(r["disc"] for r in rows)
    gross = sum(r["total"] for r in rows)
    net = sum(r["net"] for r in rows)
    vat_total = sum(r["vatamt"] for r in rows)

    # commissione della piattaforma
    if data.get("commission") not in (None, ""):
        comm = q2(data["commission"])
    elif gross > 0 and (D(ch["commission_pct"]) or D(ch["commission_fixed"])):
        comm = q2(gross * D(ch["commission_pct"]) / 100 + D(ch["commission_fixed"]))
    else:
        comm = ZERO
    comm_net, comm_vat = split_vat(comm, ch["commission_vat_rate"])

    # costo teorico e scarico ingredienti
    cost_total = ZERO
    consume: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for r in rows:
        r["version_id"], r["unit_cost"] = None, ZERO
        p = r["product"]
        if p:
            v = recipes.version_at(c, product_id=p["id"], at=sold_at)
            if v:
                card = recipes.cost_of_version(c, v)
                r["version_id"], r["unit_cost"] = v["id"], card["unit_cost"]
                cost_total += card["unit_cost"] * r["qty"]
                if p["unload_stock"] and not data.get("skip_stock"):
                    for item_id, q in recipes.explode(c, v["id"], r["qty"]).items():
                        consume[item_id] += q

    sale = c.one(
        """INSERT INTO sales(sold_at,business_date,kind,mode,channel_id,gross_before_discount,discount_total,
              gross_total,net_total,vat_total,commission_gross,commission_net,commission_vat,cost_total,notes,user_id)
           VALUES (%s,%s,'vendita',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        [sold_at, bdate, mode, ch["id"], gross_before, disc_total, gross, net, vat_total, comm, comm_net,
         comm_vat, q4(cost_total), data.get("notes"), uid],
    )
    for r in rows:
        c.exec(
            """INSERT INTO sale_lines(sale_id,product_id,description,qty,unit_price,discount,line_total,vat_rate,
                  line_net,line_vat,recipe_version_id,unit_cost) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [sale["id"], r["product"]["id"] if r["product"] else None, r["desc"], r["qty"], r["price"], r["disc"],
             r["total"], r["vat"], r["net"], r["vatamt"], r["version_id"], q6(r["unit_cost"])],
        )

    for item_id, q in sorted(consume.items()):
        if q > 0:
            stock.move(c, uid, item_id, -q, "consumo_vendita", at=sold_at, ref_type="sale", ref_id=sale["id"],
                       reason=f"Vendita n. {sale['number']}")

    _add_payments(c, sale, data.get("payments"), ch, gross)
    return sale


def _add_payments(c: db.Cursor, sale: dict, payments: list | None, ch: dict | None, gross: Decimal):
    if not payments:
        mid = (ch or {}).get("default_payment_method_id") or c.val(
            "SELECT id FROM payment_methods WHERE is_active ORDER BY sort_order, id LIMIT 1")
        payments = [{"method_id": mid, "amount": gross}]
    tot = q2(sum(D(p.get("amount")) for p in payments))
    if tot != q2(gross):
        raise bad(f"La somma dei pagamenti ({tot} €) non corrisponde al totale ({q2(gross)} €)")
    for p in payments:
        amt = q2(p.get("amount"))
        if amt == 0:
            continue
        m = c.one("SELECT * FROM payment_methods WHERE id=%s", [p.get("method_id")])
        if not m:
            raise bad("Metodo di pagamento non valido")
        pending = p.get("pending")
        if pending is None:
            pending = not m["received_immediately"]
        if pending:
            c.exec("INSERT INTO sale_payments(sale_id,method_id,amount,status) VALUES (%s,%s,%s,'in_attesa')",
                   [sale["id"], m["id"], amt])
        else:
            if not m["account_id"]:
                raise bad(f"Il metodo «{m['name']}» non ha un conto associato (Impostazioni)")
            c.exec(
                "INSERT INTO sale_payments(sale_id,method_id,amount,status,received_at,received_amount,account_id) "
                "VALUES (%s,%s,%s,'incassato',%s,%s,%s)",
                [sale["id"], m["id"], amt, sale["business_date"], amt, m["account_id"]],
            )


def void_sale(c: db.Cursor, uid: int | None, sale_id: int, reason: str) -> dict:
    s = c.one("SELECT * FROM sales WHERE id=%s FOR UPDATE", [sale_id])
    if not s:
        raise ApiError(404, "Vendita non trovata")
    if s["status"] == "annullata":
        raise conflict("Vendita già annullata")
    if c.val("SELECT 1 FROM sale_payments WHERE sale_id=%s AND settlement_id IS NOT NULL", [sale_id]):
        raise conflict("Il pagamento è già stato riconciliato con un accredito: annulla prima l'accredito")
    if s["kind"] == "vendita" and c.val("SELECT 1 FROM sales WHERE refund_of=%s AND status='valida'", [sale_id]):
        raise conflict("Esistono rimborsi collegati: annullali prima")
    c.exec("UPDATE sales SET status='annullata', voided_at=now(), voided_by=%s, void_reason=%s WHERE id=%s",
           [uid, reason, sale_id])
    c.exec("UPDATE sale_payments SET status='annullato' WHERE sale_id=%s", [sale_id])
    stock.reverse_ref(c, uid, "sale", sale_id, f"Annullamento vendita n. {s['number']}: {reason}")
    return s


def refund_sale(c: db.Cursor, uid: int | None, perms: set[str], sale_id: int, amount, method_id: int,
                reason: str, when=None) -> dict:
    """Rimborso (anche parziale) al cliente: ricavo negativo e uscita di denaro; il magazzino non cambia."""
    orig = c.one("SELECT * FROM sales WHERE id=%s", [sale_id])
    if not orig or orig["status"] != "valida" or orig["kind"] != "vendita":
        raise bad("Vendita originale non valida")
    amount = q2(amount)
    already = -D(c.val("SELECT COALESCE(sum(gross_total),0) FROM sales WHERE refund_of=%s AND status='valida'", [sale_id]))
    if amount <= 0 or amount + already > D(orig["gross_total"]):
        raise bad("Importo del rimborso non valido (supera il totale della vendita)")
    at = parse_ts(when) or now()
    check_day_open(c, at.date(), perms)
    ratio = amount / D(orig["gross_total"]) if D(orig["gross_total"]) else ZERO
    net = q2(D(orig["net_total"]) * ratio)
    vat = amount - net
    comm = q2(D(orig["commission_gross"]) * ratio) if setting(c, "refund_reverses_commission", False) else ZERO
    s = c.one(
        """INSERT INTO sales(sold_at,business_date,kind,mode,channel_id,refund_of,gross_before_discount,discount_total,
              gross_total,net_total,vat_total,commission_gross,commission_net,commission_vat,cost_total,notes,user_id)
           VALUES (%s,%s,'rimborso','riepilogo',%s,%s,%s,0,%s,%s,%s,%s,%s,0,0,%s,%s) RETURNING *""",
        [at, at.date(), orig["channel_id"], sale_id, -amount, -amount, -net, -vat, -comm, -comm, reason, uid],
    )
    c.exec(
        "INSERT INTO sale_lines(sale_id,description,qty,unit_price,discount,line_total,vat_rate,line_net,line_vat) "
        "VALUES (%s,%s,1,%s,0,%s,%s,%s,%s)",
        [s["id"], f"Rimborso vendita n. {orig['number']}", -amount, -amount,
         (q2(vat / net * 100) if net else 0), -net, -vat],
    )
    _add_payments(c, s, [{"method_id": method_id, "amount": -amount, "pending": False}], None, -amount)
    return s


def day_summary(c: db.Cursor, d: dt.date) -> dict:
    by_method = c.all(
        """SELECT pm.id AS method_id, pm.name, pm.kind,
                  COALESCE(sum(sp.amount) FILTER (WHERE sp.status='incassato'),0) AS received,
                  COALESCE(sum(sp.amount) FILTER (WHERE sp.status='in_attesa'),0) AS pending
           FROM payment_methods pm
           LEFT JOIN sale_payments sp ON sp.method_id = pm.id AND sp.status <> 'annullato'
                AND sp.sale_id IN (SELECT id FROM sales WHERE business_date=%s AND status='valida')
           GROUP BY pm.id ORDER BY pm.sort_order, pm.id""",
        [d],
    )
    tot = c.one(
        """SELECT count(*) FILTER (WHERE kind='vendita') AS n_sales,
                  COALESCE(sum(gross_total),0) AS gross, COALESCE(sum(net_total),0) AS net,
                  COALESCE(sum(discount_total),0) AS discounts,
                  COALESCE(-sum(gross_total) FILTER (WHERE kind='rimborso'),0) AS refunds,
                  COALESCE(sum(commission_gross),0) AS commissions
           FROM sales WHERE business_date=%s AND status='valida'""",
        [d],
    )
    by_channel = c.all(
        """SELECT ch.name, count(s.id) AS n, COALESCE(sum(s.gross_total),0) AS gross
           FROM sales s JOIN sales_channels ch ON ch.id=s.channel_id
           WHERE s.business_date=%s AND s.status='valida' GROUP BY ch.name ORDER BY gross DESC""",
        [d],
    )
    closure = c.one("SELECT * FROM day_closures WHERE business_date=%s", [d])
    return {"date": d, "totals": tot, "by_method": by_method, "by_channel": by_channel, "closure": closure}


def close_day(c: db.Cursor, uid: int | None, d: dt.date, counted: dict, notes: str | None,
              adjust_cash: bool) -> dict:
    if c.val("SELECT 1 FROM day_closures WHERE business_date=%s", [d]):
        raise conflict("Giornata già chiusa")
    summ = day_summary(c, d)
    expected = {str(r["method_id"]): q2(r["received"]) for r in summ["by_method"]}
    counted_c = {k: q2(v) for k, v in (counted or {}).items() if v not in (None, "")}
    diff = sum((counted_c[k] - expected.get(k, ZERO)) for k in counted_c)
    row = c.one(
        "INSERT INTO day_closures(business_date,expected,counted,difference,notes,closed_by) "
        "VALUES (%s,%s::jsonb,%s::jsonb,%s,%s,%s) RETURNING *",
        [d, {k: str(v) for k, v in expected.items()}, {k: str(v) for k, v in counted_c.items()}, diff, notes, uid],
    )
    if adjust_cash:
        for k, v in counted_c.items():
            m = c.one("SELECT * FROM payment_methods WHERE id=%s", [int(k)])
            delta = v - expected.get(k, ZERO)
            if m and m["kind"] == "contanti" and delta != 0 and m["account_id"]:
                c.exec(
                    "INSERT INTO cash_movements(account_id,moved_at,amount,kind,description,user_id) "
                    "VALUES (%s,%s,%s,'rettifica',%s,%s)",
                    [m["account_id"], d, delta, f"Differenza di cassa chiusura {d.strftime('%d/%m/%Y')}", uid],
                )
    return row


def settle(c: db.Cursor, uid: int | None, payment_ids: list[int], received_at: dt.date, account_id: int,
           amount, channel_id: int | None, notes: str | None) -> dict:
    """Registra un accredito cumulativo (es. bonifico della piattaforma) e salda i crediti selezionati."""
    if not payment_ids:
        raise bad("Seleziona almeno un credito da incassare")
    rows = c.all("SELECT * FROM sale_payments WHERE id = ANY(%s::bigint[]) FOR UPDATE", [payment_ids])
    if len(rows) != len(set(payment_ids)) or any(r["status"] != "in_attesa" for r in rows):
        raise conflict("Alcuni crediti non sono più in attesa: aggiorna la pagina")
    amount = q2(amount)
    st = c.one(
        "INSERT INTO settlements(channel_id,received_at,account_id,amount,notes,user_id) "
        "VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        [channel_id, received_at, account_id, amount, notes, uid],
    )
    gross = sum(D(r["amount"]) for r in rows)
    shares = _distribute(amount, [D(r["amount"]) for r in rows]) if gross else [ZERO] * len(rows)
    for r, sh in zip(rows, shares):
        c.exec(
            "UPDATE sale_payments SET status='incassato', received_at=%s, received_amount=%s, settlement_id=%s "
            "WHERE id=%s",
            [received_at, sh, st["id"], r["id"]],
        )
    st["gross_pending"] = gross
    return st


def void_settlement(c: db.Cursor, settlement_id: int):
    st = c.one("SELECT * FROM settlements WHERE id=%s FOR UPDATE", [settlement_id])
    if not st or st["voided_at"]:
        raise bad("Accredito non valido")
    c.exec("UPDATE sale_payments SET status='in_attesa', received_at=NULL, received_amount=NULL, settlement_id=NULL "
           "WHERE settlement_id=%s", [settlement_id])
    c.exec("UPDATE settlements SET voided_at=now() WHERE id=%s", [settlement_id])
    return st
