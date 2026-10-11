"""Ordini di acquisto, ricevimento merce, produzione semilavorati."""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from .. import db
from ..common import ZERO, D, add_vat, now, parse_ts, q2, q4, q6, today
from ..http import ApiError, bad, conflict
from . import expenses, recipes, stock


def next_po_number(c: db.Cursor) -> str:
    n = c.val("SELECT nextval('po_number_seq')")
    return f"OA-{today().year}-{n:04d}"


def receive(c: db.Cursor, uid: int | None, data: dict) -> dict:
    """Ricevimento merce: carica il magazzino (movimenti 'acquisto'), aggiorna l'ordine e i prezzi fornitore.
    Facoltativamente crea la spesa collegata (fattura/ricevuta), che NON sarà conteggiata due volte
    nel conto economico (categoria di magazzino → costo rilevato al consumo).

    data: supplier_id, po_id, received_at, doc_ref, notes,
          lines[{item_id, qty, unit_cost (netto per unità di magazzino), vat_rate, po_line_id, lot_code, expiry_date,
                 qty_unit (facoltativa, unità in cui è espressa la quantità)}],
          expense: {create: bool, category_id, doc_number, doc_date, due_date, paid_now, payment_method_id, account_id}
    """
    lines = [l for l in (data.get("lines") or []) if D(l.get("qty")) > 0]
    if not lines:
        raise bad("Inserisci almeno un articolo ricevuto")
    po = None
    if data.get("po_id"):
        po = c.one("SELECT * FROM purchase_orders WHERE id=%s FOR UPDATE", [data["po_id"]])
        if not po or po["status"] in ("annullato", "chiuso", "bozza"):
            raise bad("L'ordine non è in uno stato che consente il ricevimento (deve essere inviato)")
    supplier_id = data.get("supplier_id") or (po["supplier_id"] if po else None)
    at = parse_ts(data.get("received_at")) or now()
    r = c.one(
        "INSERT INTO goods_receipts(supplier_id,po_id,received_at,doc_ref,notes,user_id) "
        "VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
        [supplier_id, po["id"] if po else None, at, data.get("doc_ref"), data.get("notes"), uid],
    )
    total_net = ZERO
    total_vat = ZERO
    for ln in lines:
        it = c.one("SELECT * FROM items WHERE id=%s", [ln["item_id"]])
        if not it:
            raise bad("Articolo inesistente")
        qty = D(ln["qty"])
        cost = D(ln.get("unit_cost") or 0)
        if ln.get("qty_unit") and ln["qty_unit"] != it["unit_code"]:
            f = stock.unit_factor(c, ln["qty_unit"], it["unit_code"])
            qty = qty * f
            cost = cost / f
        qty, cost = q4(qty), q6(cost)
        vat_rate = D(ln.get("vat_rate") if ln.get("vat_rate") not in (None, "") else it["vat_rate"])
        if ln.get("po_line_id"):
            pol = c.one("SELECT * FROM purchase_order_lines WHERE id=%s AND po_id=%s FOR UPDATE",
                        [ln["po_line_id"], po["id"] if po else None])
            if not pol:
                raise bad("Riga d'ordine non valida")
            c.exec("UPDATE purchase_order_lines SET qty_received = qty_received + %s WHERE id=%s", [qty, pol["id"]])
        c.exec(
            "INSERT INTO goods_receipt_lines(receipt_id,po_line_id,item_id,qty,unit_cost,vat_rate,lot_code,expiry_date) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            [r["id"], ln.get("po_line_id"), it["id"], qty, cost, vat_rate, ln.get("lot_code"), ln.get("expiry_date")],
        )
        stock.move(c, uid, it["id"], qty, "acquisto", unit_cost=cost, at=at, ref_type="goods_receipt", ref_id=r["id"],
                   reason=f"Ricevimento merce{(' ' + data['doc_ref']) if data.get('doc_ref') else ''}",
                   lot_code=ln.get("lot_code"), expiry_date=ln.get("expiry_date"))
        if supplier_id:
            c.exec(
                """INSERT INTO supplier_items(supplier_id,item_id,unit_price,last_price_at) VALUES (%s,%s,%s,%s)
                   ON CONFLICT (supplier_id,item_id) DO UPDATE SET unit_price=EXCLUDED.unit_price,
                   last_price_at=EXCLUDED.last_price_at""",
                [supplier_id, it["id"], cost, at.date()],
            )
        line_net = q2(qty * cost)
        total_net += line_net
        total_vat += add_vat(line_net, vat_rate)[0]

    if po:
        _refresh_po_status(c, po["id"])

    exp = None
    e = data.get("expense") or {}
    if e.get("create"):
        cat = e.get("category_id") or c.val(
            "SELECT id FROM expense_categories WHERE is_inventory AND is_active ORDER BY sort_order LIMIT 1")
        sup = c.one("SELECT * FROM suppliers WHERE id=%s", [supplier_id]) if supplier_id else None
        doc_date = e.get("doc_date") or at.date()
        due = e.get("due_date")
        if not due and sup and sup.get("payment_days"):
            due = (dt.date.fromisoformat(str(doc_date)) if isinstance(doc_date, str) else doc_date) + \
                dt.timedelta(days=sup["payment_days"])
        net = q2(e["net_amount"]) if e.get("net_amount") not in (None, "") else total_net
        vat = q2(e["vat_amount"]) if e.get("vat_amount") not in (None, "") else total_vat
        exp = expenses.create(c, uid, {
            "description": f"Acquisto merce{(' – ' + sup['legal_name']) if sup else ''}"
                           f"{(' (' + data['doc_ref'] + ')') if data.get('doc_ref') else ''}",
            "category_id": cat, "supplier_id": supplier_id, "doc_type": e.get("doc_type") or "fattura",
            "doc_number": e.get("doc_number") or data.get("doc_ref"), "doc_date": doc_date,
            "net_amount": net, "vat_amount": vat, "due_date": due, "po_id": po["id"] if po else None,
            "receipt_id": r["id"], "paid_now": e.get("paid_now"), "payment_method_id": e.get("payment_method_id"),
            "account_id": e.get("account_id"),
        })
    r["expense"] = exp
    r["total_net"] = total_net
    return r


def _refresh_po_status(c: db.Cursor, po_id: int):
    agg = c.one(
        "SELECT bool_and(qty_received >= qty_ordered) AS all_in, bool_or(qty_received > 0) AS any_in "
        "FROM purchase_order_lines WHERE po_id=%s", [po_id])
    status = "ricevuto" if agg["all_in"] else ("parziale" if agg["any_in"] else None)
    if status:
        c.exec("UPDATE purchase_orders SET status=%s, updated_at=now() WHERE id=%s AND status NOT IN ('annullato','chiuso')",
               [status, po_id])


def void_receipt(c: db.Cursor, uid: int | None, receipt_id: int, reason: str):
    r = c.one("SELECT * FROM goods_receipts WHERE id=%s FOR UPDATE", [receipt_id])
    if not r or r["voided_at"]:
        raise bad("Ricevimento non valido")
    if c.val("SELECT 1 FROM expenses WHERE receipt_id=%s AND voided_at IS NULL", [receipt_id]):
        raise conflict("Al ricevimento è collegata una spesa: annulla prima la spesa")
    stock.reverse_ref(c, uid, "goods_receipt", receipt_id, f"Annullamento ricevimento: {reason}")
    for ln in c.all("SELECT * FROM goods_receipt_lines WHERE receipt_id=%s AND po_line_id IS NOT NULL", [receipt_id]):
        c.exec("UPDATE purchase_order_lines SET qty_received = qty_received - %s WHERE id=%s", [ln["qty"], ln["po_line_id"]])
    c.exec("UPDATE goods_receipts SET voided_at=now(), voided_by=%s WHERE id=%s", [uid, receipt_id])
    if r["po_id"]:
        c.exec("UPDATE purchase_orders SET status='inviato' WHERE id=%s AND status IN ('parziale','ricevuto')", [r["po_id"]])
        _refresh_po_status(c, r["po_id"])
    return r


def produce(c: db.Cursor, uid: int | None, item_id: int, qty, notes: str | None, at=None) -> dict:
    """Produzione di un semilavorato: scarica gli ingredienti e carica il semilavorato al costo effettivo."""
    it = c.one("SELECT * FROM items WHERE id=%s", [item_id])
    if not it or it["kind"] != "semilavorato":
        raise bad("Seleziona un semilavorato")
    v = recipes.version_at(c, item_id=item_id)
    if not v:
        raise bad("Il semilavorato non ha una ricetta")
    qty = q4(qty)
    if qty <= 0:
        raise bad("Quantità non valida")
    at = parse_ts(at) or now()
    need = recipes.explode(c, v["id"], qty)
    p = c.one(
        "INSERT INTO productions(item_id,recipe_version_id,qty_produced,produced_at,total_cost,notes,user_id) "
        "VALUES (%s,%s,%s,%s,0,%s,%s) RETURNING *",
        [item_id, v["id"], qty, at, notes, uid],
    )
    total = ZERO
    for ing, q in sorted(need.items()):
        if ing == item_id:
            raise bad("Ricetta circolare")
        mv = stock.move(c, uid, ing, -q, "produzione_scarico", at=at, ref_type="production", ref_id=p["id"],
                        reason=f"Produzione {it['name']}")
        total += -D(mv["value"])
    stock.move(c, uid, item_id, qty, "produzione_carico", unit_cost=total / qty, at=at, ref_type="production",
               ref_id=p["id"], reason="Produzione")
    c.exec("UPDATE productions SET total_cost=%s WHERE id=%s", [q4(total), p["id"]])
    p["total_cost"] = q4(total)
    return p
