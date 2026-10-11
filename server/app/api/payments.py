"""Incassi: crediti da incassare, accrediti delle piattaforme, conti e movimenti di cassa."""
import datetime as dt
import uuid
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from .. import db
from ..common import today
from ..http import Ctx, api, audit, bad, not_found
from ..services import reports
from ..services import sales as svc


@api("GET", "/receivables", "payments.view")
def receivables(ctx: Ctx):
    where, params = ["sp.status='in_attesa'", "s.status='valida'"], []
    if ctx.q("channel_id"):
        where.append("s.channel_id=%s"); params.append(ctx.q("channel_id", cast=int))
    if ctx.qdate("to"):
        where.append("s.business_date <= %s"); params.append(ctx.qdate("to"))
    with db.read() as c:
        return c.all(
            f"""SELECT sp.*, s.number, s.business_date, s.gross_total, s.commission_gross, s.channel_id,
                       ch.name AS channel_name, pm.name AS method_name
                FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id JOIN sales_channels ch ON ch.id=s.channel_id
                JOIN payment_methods pm ON pm.id=sp.method_id
                WHERE {' AND '.join(where)} ORDER BY s.business_date, s.id""", params)


@api("GET", "/received", "payments.view")
def received(ctx: Ctx):
    d1, d2 = ctx.qdate("from", today().replace(day=1)), ctx.qdate("to", today())
    with db.read() as c:
        direct = c.all(
            """SELECT sp.received_at AS day, pm.name AS method_name, a.name AS account_name, sum(sp.amount) AS amount, count(*) AS n
               FROM sale_payments sp JOIN payment_methods pm ON pm.id=sp.method_id LEFT JOIN accounts a ON a.id=sp.account_id
               WHERE sp.status='incassato' AND sp.settlement_id IS NULL AND sp.received_at BETWEEN %s AND %s
               GROUP BY 1,2,3 ORDER BY 1 DESC, 2""", [d1, d2])
        settl = c.all(
            """SELECT st.*, ch.name AS channel_name, a.name AS account_name,
                      (SELECT sum(amount) FROM sale_payments WHERE settlement_id=st.id) AS gross_settled,
                      (SELECT count(*) FROM sale_payments WHERE settlement_id=st.id) AS n
               FROM settlements st LEFT JOIN sales_channels ch ON ch.id=st.channel_id JOIN accounts a ON a.id=st.account_id
               WHERE st.received_at BETWEEN %s AND %s ORDER BY st.received_at DESC""", [d1, d2])
        return {"direct": direct, "settlements": settl}


class SettleIn(BaseModel):
    payment_ids: list[int] = Field(min_length=1)
    received_at: dt.date
    account_id: int
    amount: Decimal = Field(ge=0)
    channel_id: int | None = None
    notes: str | None = None


@api("POST", "/settlements", "payments.manage")
def create_settlement(ctx: Ctx):
    data = ctx.parse(SettleIn)
    with db.tx() as c:
        st = svc.settle(c, ctx.uid, data.payment_ids, data.received_at, data.account_id, data.amount,
                        data.channel_id, data.notes)
        audit(c, ctx, "create", "settlement", st["id"],
              f"Accredito di {data.amount} € per {len(data.payment_ids)} crediti (lordo {st['gross_pending']} €)")
    return st


@api("POST", "/settlements/{id}/void", "payments.manage")
def void_settlement(ctx: Ctx):
    with db.tx() as c:
        st = svc.void_settlement(c, ctx.pid())
        audit(c, ctx, "void", "settlement", st["id"], f"Accredito di {st['amount']} € annullato", st)
    return {"ok": True}


@api("POST", "/receivables/mark-received", "payments.manage")
def mark_received(ctx: Ctx):
    """Segna come incassati singoli crediti (es. pagamento cliente evento), importo pieno sul conto indicato."""
    body = ctx.body or {}
    ids = body.get("payment_ids") or []
    acc = body.get("account_id")
    d = body.get("received_at") or today().isoformat()
    if not ids or not acc:
        raise bad("Seleziona i crediti e il conto")
    with db.tx() as c:
        n = c.exec("UPDATE sale_payments SET status='incassato', received_at=%s, received_amount=amount, account_id=%s "
                   "WHERE id = ANY(%s::bigint[]) AND status='in_attesa'", [d, acc, ids])
        audit(c, ctx, "update", "sale_payment", ",".join(map(str, ids)), f"{n} crediti segnati come incassati")
    return {"updated": n}


@api("GET", "/accounts/balances", "payments.view")
def balances(ctx: Ctx):
    with db.read() as c:
        return reports.account_balances(c, ctx.qdate("at", today()))


@api("GET", "/cash-movements", "payments.view")
def list_cash(ctx: Ctx):
    with db.read() as c:
        return c.all("""SELECT cm.*, a.name AS account_name, u.full_name AS user_name FROM cash_movements cm
                        JOIN accounts a ON a.id=cm.account_id LEFT JOIN users u ON u.id=cm.user_id
                        ORDER BY moved_at DESC, id DESC LIMIT 300""")


class CashIn(BaseModel):
    kind: Literal["giroconto", "apporto", "prelievo", "finanziamento", "rettifica", "altro"]
    account_id: int
    to_account_id: int | None = None
    amount: Decimal = Field(gt=0)
    moved_at: dt.date
    description: str = Field(min_length=2, max_length=300)
    direction: Literal["entrata", "uscita"] = "entrata"


@api("POST", "/cash-movements", "payments.manage")
def create_cash(ctx: Ctx):
    data = ctx.parse(CashIn)
    with db.tx() as c:
        if data.kind == "giroconto":
            if not data.to_account_id or data.to_account_id == data.account_id:
                raise bad("Indica il conto di destinazione del giroconto")
            g = str(uuid.uuid4())
            for acc, amt in ((data.account_id, -data.amount), (data.to_account_id, data.amount)):
                c.exec("INSERT INTO cash_movements(account_id,moved_at,amount,kind,transfer_group,description,user_id) "
                       "VALUES (%s,%s,%s,'giroconto',%s::uuid,%s,%s)", [acc, data.moved_at, amt, g, data.description, ctx.uid])
        else:
            sign = -1 if data.kind == "prelievo" or (data.kind in ("rettifica", "altro", "finanziamento") and data.direction == "uscita") else 1
            c.exec("INSERT INTO cash_movements(account_id,moved_at,amount,kind,description,user_id) VALUES (%s,%s,%s,%s,%s,%s)",
                   [data.account_id, data.moved_at, sign * data.amount, data.kind, data.description, ctx.uid])
        audit(c, ctx, "create", "cash_movement", None, f"{data.kind}: {data.amount} € – {data.description}")
    return {"ok": True}


@api("POST", "/cash-movements/{id}/void", "payments.manage")
def void_cash(ctx: Ctx):
    with db.tx() as c:
        m = c.one("SELECT * FROM cash_movements WHERE id=%s", [ctx.pid()])
        if not m or m["voided_at"]:
            raise not_found("Movimento")
        if m["transfer_group"]:
            c.exec("UPDATE cash_movements SET voided_at=now() WHERE transfer_group=%s", [m["transfer_group"]])
        else:
            c.exec("UPDATE cash_movements SET voided_at=now() WHERE id=%s", [m["id"]])
        audit(c, ctx, "void", "cash_movement", m["id"], f"Movimento di cassa annullato ({m['amount']} €)", m)
    return {"ok": True}
