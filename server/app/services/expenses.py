"""Spese, pagamenti e spese ricorrenti."""
from __future__ import annotations

import datetime as dt

from .. import db
from ..common import ZERO, D, add_months, add_vat, q2, today
from ..http import ApiError, bad, conflict

FREQ_MONTHS = {"mensile": 1, "bimestrale": 2, "trimestrale": 3, "semestrale": 6, "annuale": 12}


def refresh_status(c: db.Cursor, expense_id: int) -> dict:
    e = c.one("SELECT * FROM expenses WHERE id=%s FOR UPDATE", [expense_id])
    paid = D(c.val("SELECT COALESCE(sum(amount),0) FROM expense_payments WHERE expense_id=%s AND voided_at IS NULL",
                   [expense_id]))
    tot = D(e["total_amount"])
    if paid == 0:
        status = "da_pagare"
    elif (tot >= 0 and paid >= tot) or (tot < 0 and paid <= tot):
        status = "pagata"
    else:
        status = "parziale"
    c.exec("UPDATE expenses SET paid_amount=%s, status=%s WHERE id=%s", [paid, status, expense_id])
    e["paid_amount"], e["status"] = paid, status
    return e


def amounts(data: dict) -> tuple:
    """Calcola imponibile/IVA/totale. Si può indicare: netto + aliquota, oppure totale + aliquota, oppure tutti."""
    rate = data.get("vat_rate")
    net, vat, tot = data.get("net_amount"), data.get("vat_amount"), data.get("total_amount")
    if net not in (None, "") and vat not in (None, ""):
        net, vat = q2(net), q2(vat)
        return net, vat, net + vat
    if net not in (None, ""):
        v, t = add_vat(net, rate or 0)
        return q2(net), v, t
    if tot not in (None, ""):
        tot = q2(tot)
        n = q2(tot / (1 + D(rate or 0) / 100))
        return n, tot - n, tot
    raise bad("Indica l'importo della spesa")


def create(c: db.Cursor, uid: int | None, data: dict) -> dict:
    cat = c.one("SELECT * FROM expense_categories WHERE id=%s", [data.get("category_id")])
    if not cat:
        raise bad("Categoria non valida")
    net, vat, tot = amounts(data)
    doc_date = data.get("doc_date") or today()
    e = c.one(
        """INSERT INTO expenses(description,category_id,supplier_id,doc_type,doc_number,doc_date,competence_date,
              net_amount,vat_amount,total_amount,vat_deductible,due_date,recurring_id,recurring_period,po_id,
              receipt_id,notes,created_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        [data["description"], cat["id"], data.get("supplier_id"), data.get("doc_type") or "fattura",
         data.get("doc_number"), doc_date, data.get("competence_date") or doc_date, net, vat, tot,
         data.get("vat_deductible", True), data.get("due_date"), data.get("recurring_id"),
         data.get("recurring_period"), data.get("po_id"), data.get("receipt_id"), data.get("notes"), uid],
    )
    if data.get("paid_now"):
        add_payment(c, uid, e["id"], {
            "paid_at": data.get("paid_at") or doc_date, "amount": tot,
            "method_id": data.get("payment_method_id"), "account_id": data.get("account_id"),
        })
        e = c.one("SELECT * FROM expenses WHERE id=%s", [e["id"]])
    return e


def update(c: db.Cursor, expense_id: int, data: dict, version: int | None) -> tuple[dict, dict]:
    before = c.one("SELECT * FROM expenses WHERE id=%s FOR UPDATE", [expense_id])
    if not before or before["voided_at"]:
        raise ApiError(404, "Spesa non trovata")
    if version is not None and version != before["version"]:
        raise conflict("La spesa è stata modificata da un altro utente: ricarica la pagina")
    net, vat, tot = amounts(data)
    paid = D(before["paid_amount"])
    if paid and abs(tot) < abs(paid):
        raise bad("Il nuovo totale è inferiore a quanto già pagato")
    c.exec(
        """UPDATE expenses SET description=%s, category_id=%s, supplier_id=%s, doc_type=%s, doc_number=%s,
              doc_date=%s, competence_date=%s, net_amount=%s, vat_amount=%s, total_amount=%s, vat_deductible=%s,
              due_date=%s, notes=%s, updated_at=now(), version=version+1 WHERE id=%s""",
        [data["description"], data["category_id"], data.get("supplier_id"), data.get("doc_type") or "fattura",
         data.get("doc_number"), data["doc_date"], data.get("competence_date") or data["doc_date"], net, vat, tot,
         data.get("vat_deductible", True), data.get("due_date"), data.get("notes"), expense_id],
    )
    after = refresh_status(c, expense_id)
    return before, c.one("SELECT * FROM expenses WHERE id=%s", [expense_id])


def void(c: db.Cursor, uid: int | None, expense_id: int, reason: str) -> dict:
    e = c.one("SELECT * FROM expenses WHERE id=%s FOR UPDATE", [expense_id])
    if not e or e["voided_at"]:
        raise ApiError(404, "Spesa non trovata")
    if c.val("SELECT 1 FROM expense_payments WHERE expense_id=%s AND voided_at IS NULL", [expense_id]):
        raise conflict("La spesa ha pagamenti registrati: annulla prima i pagamenti")
    c.exec("UPDATE expenses SET voided_at=now(), voided_by=%s, void_reason=%s WHERE id=%s", [uid, reason, expense_id])
    return e


def add_payment(c: db.Cursor, uid: int | None, expense_id: int, data: dict) -> dict:
    e = c.one("SELECT * FROM expenses WHERE id=%s FOR UPDATE", [expense_id])
    if not e or e["voided_at"]:
        raise bad("Spesa non valida")
    amount = q2(data.get("amount") if data.get("amount") not in (None, "") else D(e["total_amount"]) - D(e["paid_amount"]))
    if amount == 0:
        raise bad("Importo del pagamento non valido")
    residual = D(e["total_amount"]) - D(e["paid_amount"])
    if (residual >= 0 and amount > residual) or (residual < 0 and amount < residual):
        raise bad(f"L'importo supera il residuo da pagare ({q2(residual)} €)")
    account_id = data.get("account_id")
    method_id = data.get("method_id")
    if not account_id and method_id:
        account_id = c.val("SELECT account_id FROM payment_methods WHERE id=%s", [method_id])
    if not account_id:
        account_id = c.val("SELECT id FROM accounts WHERE kind='banca' AND is_active ORDER BY id LIMIT 1")
    if not account_id:
        raise bad("Indica il conto da cui è stato effettuato il pagamento")
    p = c.one(
        "INSERT INTO expense_payments(expense_id,paid_at,amount,method_id,account_id,notes,user_id) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        [expense_id, data.get("paid_at") or today(), amount, method_id, account_id, data.get("notes"), uid],
    )
    refresh_status(c, expense_id)
    return p


def void_payment(c: db.Cursor, uid: int | None, payment_id: int) -> dict:
    p = c.one("SELECT * FROM expense_payments WHERE id=%s FOR UPDATE", [payment_id])
    if not p or p["voided_at"]:
        raise bad("Pagamento non valido")
    c.exec("UPDATE expense_payments SET voided_at=now(), voided_by=%s WHERE id=%s", [uid, payment_id])
    refresh_status(c, p["expense_id"])
    return p


def _periods(r: dict, until: dt.date):
    step = FREQ_MONTHS[r["frequency"]]
    first = r["start_date"].replace(day=r["day_of_month"])
    if first < r["start_date"]:
        first = add_months(first, step)
    for k in range(600):
        d = add_months(first, step * k)
        if d > until or (r["end_date"] and d > r["end_date"]):
            break
        yield d


def generate_recurring(c: db.Cursor, horizon_days: int = 31) -> int:
    """Crea le spese (DA PAGARE) delle ricorrenze fino a oggi + orizzonte. Idempotente:
    non crea doppioni e non registra alcun pagamento."""
    until = today() + dt.timedelta(days=horizon_days)
    created = 0
    for r in c.all("SELECT * FROM recurring_expenses WHERE is_active"):
        for period in _periods(r, until):
            if c.val("SELECT 1 FROM expenses WHERE recurring_id=%s AND recurring_period=%s", [r["id"], period]):
                continue
            if c.val("SELECT 1 FROM period_closures WHERE period=date_trunc('month', %s::date)::date", [period]):
                continue
            vat, tot = add_vat(r["net_amount"], r["vat_rate"])
            c.exec(
                """INSERT INTO expenses(description,category_id,supplier_id,doc_type,doc_date,competence_date,
                      net_amount,vat_amount,total_amount,vat_deductible,due_date,recurring_id,recurring_period,notes)
                   VALUES (%s,%s,%s,'altro',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT DO NOTHING""",
                [f"{r['description']} – {period.strftime('%m/%Y')}", r["category_id"], r["supplier_id"], period,
                 period, q2(r["net_amount"]), vat, tot, r["vat_deductible"],
                 period + dt.timedelta(days=r["due_days"]), r["id"], period,
                 "Generata automaticamente dalla spesa ricorrente"],
            )
            created += 1
        c.exec("UPDATE recurring_expenses SET last_generated=%s WHERE id=%s", [today(), r["id"]])
    return created
