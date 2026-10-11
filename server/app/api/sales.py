"""Vendite, rimborsi, chiusura di cassa."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from .. import db
from ..common import today
from ..http import Ctx, api, audit, bad, not_found
from ..services import sales as svc


class LineIn(BaseModel):
    product_id: int | None = None
    description: str | None = None
    qty: Decimal = Field(default=Decimal(1), gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    vat_rate: Decimal | None = Field(default=None, ge=0, le=100)


class PaymentIn(BaseModel):
    method_id: int
    amount: Decimal
    pending: bool | None = None


class SaleIn(BaseModel):
    sold_at: str | None = None
    channel_id: int
    mode: Literal["analitica", "riepilogo"] = "analitica"
    lines: list[LineIn] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal(0), ge=0)
    payments: list[PaymentIn] = []
    commission: Decimal | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=500)


@api("POST", "/sales", "sales.create")
def create_sale(ctx: Ctx):
    data = ctx.parse(SaleIn)
    if data.sold_at and not ctx.can("sales.void"):
        # gli addetti non possono registrare vendite in date passate oltre la giornata corrente
        d = dt.date.fromisoformat(data.sold_at[:10])
        if d < today() - dt.timedelta(days=1):
            raise bad("Puoi registrare vendite solo per oggi o ieri")
    with db.tx() as c:
        s = svc.create_sale(c, ctx.uid, ctx.perms, data.model_dump())
        audit(c, ctx, "create", "sale", s["id"],
              f"Vendita n. {s['number']} – {s['gross_total']} € ({data.mode})", None,
              {"gross_total": s["gross_total"], "lines": len(data.lines)})
    return s


SALE_LIST = """
    SELECT s.*, ch.name AS channel_name, u.full_name AS user_name,
      (SELECT string_agg(COALESCE(l.description,'') || CASE WHEN l.qty <> 1 THEN ' ×' || trim_scale(l.qty) ELSE '' END, ', ')
         FROM sale_lines l WHERE l.sale_id=s.id) AS items_text,
      (SELECT string_agg(DISTINCT pm.name, ', ') FROM sale_payments sp JOIN payment_methods pm ON pm.id=sp.method_id
         WHERE sp.sale_id=s.id) AS methods_text,
      (SELECT COALESCE(sum(sp.amount),0) FROM sale_payments sp WHERE sp.sale_id=s.id AND sp.status='in_attesa') AS pending_amount
    FROM sales s JOIN sales_channels ch ON ch.id=s.channel_id LEFT JOIN users u ON u.id=s.user_id
"""


@api("GET", "/sales", "sales.view")
def list_sales(ctx: Ctx):
    where, params = [], []
    d1, d2 = ctx.qdate("from"), ctx.qdate("to")
    if d1:
        where.append("s.business_date >= %s"); params.append(d1)
    if d2:
        where.append("s.business_date <= %s"); params.append(d2)
    if ctx.q("channel_id"):
        where.append("s.channel_id=%s"); params.append(ctx.q("channel_id", cast=int))
    if ctx.q("status"):
        where.append("s.status=%s"); params.append(ctx.q("status"))
    if ctx.q("kind"):
        where.append("s.kind=%s"); params.append(ctx.q("kind"))
    if ctx.q("mode"):
        where.append("s.mode=%s"); params.append(ctx.q("mode"))
    if ctx.q("product_id"):
        where.append("EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id=s.id AND l.product_id=%s)")
        params.append(ctx.q("product_id", cast=int))
    if ctx.q("method_id"):
        where.append("EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=s.id AND sp.method_id=%s)")
        params.append(ctx.q("method_id", cast=int))
    if ctx.q("discounted") == "1":
        where.append("s.discount_total > 0")
    if ctx.q("pending") == "1":
        where.append("EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=s.id AND sp.status='in_attesa')")
    if ctx.q("search"):
        where.append("(s.notes ILIKE %s OR s.number::text = %s OR EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id=s.id AND l.description ILIKE %s))")
        params += [f"%{ctx.q('search')}%", ctx.q("search"), f"%{ctx.q('search')}%"]
    limit = min(ctx.q("limit", 300, int), 5000)
    with db.read() as c:
        rows = c.all(SALE_LIST + (" WHERE " + " AND ".join(where) if where else "")
                     + f" ORDER BY s.sold_at DESC, s.id DESC LIMIT {limit}", params)
        if not ctx.can("products.costs"):
            for r in rows:
                r.pop("cost_total", None)
        return rows


@api("GET", "/sales/{id}", "sales.view")
def get_sale(ctx: Ctx):
    with db.read() as c:
        s = c.one(SALE_LIST + " WHERE s.id=%s", [ctx.pid()])
        if not s:
            raise not_found("Vendita")
        s["lines"] = c.all("SELECT l.*, p.code FROM sale_lines l LEFT JOIN products p ON p.id=l.product_id "
                           "WHERE sale_id=%s ORDER BY id", [s["id"]])
        s["payments"] = c.all(
            "SELECT sp.*, pm.name AS method_name, a.name AS account_name FROM sale_payments sp "
            "JOIN payment_methods pm ON pm.id=sp.method_id LEFT JOIN accounts a ON a.id=sp.account_id "
            "WHERE sale_id=%s ORDER BY id", [s["id"]])
        s["refunds"] = c.all("SELECT id, number, gross_total, sold_at, status FROM sales WHERE refund_of=%s", [s["id"]])
        if ctx.can("inventory.view"):
            s["movements"] = c.all(
                "SELECT m.id, m.qty, m.type, m.value, i.name, i.unit_code FROM stock_movements m JOIN items i ON i.id=m.item_id "
                "WHERE m.ref_type='sale' AND m.ref_id=%s ORDER BY m.id", [s["id"]])
        if not ctx.can("products.costs"):
            s.pop("cost_total", None)
            for ln in s["lines"]:
                ln.pop("unit_cost", None)
            for m in s.get("movements", []):
                m.pop("value", None)
        return s


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@api("POST", "/sales/{id}/void", "sales.void")
def void_sale(ctx: Ctx):
    data = ctx.parse(VoidIn)
    with db.tx() as c:
        s = svc.void_sale(c, ctx.uid, ctx.pid(), data.reason)
        audit(c, ctx, "void", "sale", s["id"], f"Vendita n. {s['number']} annullata: {data.reason}",
              {"status": "valida", "gross_total": s["gross_total"]}, {"status": "annullata"})
    return {"ok": True}


class RefundIn(BaseModel):
    amount: Decimal = Field(gt=0)
    method_id: int
    reason: str = Field(min_length=3, max_length=300)
    at: str | None = None


@api("POST", "/sales/{id}/refund", "sales.refund")
def refund(ctx: Ctx):
    data = ctx.parse(RefundIn)
    with db.tx() as c:
        s = svc.refund_sale(c, ctx.uid, ctx.perms, ctx.pid(), data.amount, data.method_id, data.reason, data.at)
        audit(c, ctx, "create", "sale", s["id"], f"Rimborso {data.amount} € sulla vendita #{ctx.pid()}: {data.reason}")
    return s


@api("GET", "/days/{date}", ["sales.close_day", "sales.view"])
def day(ctx: Ctx):
    try:
        d = dt.date.fromisoformat(ctx.params["date"])
    except ValueError:
        raise bad("Data non valida")
    with db.read() as c:
        out = svc.day_summary(c, d)
    if not ctx.can("sales.view"):
        out = _blind(out)
    return out


def _blind(out: dict) -> dict:
    """Conta alla cieca per chi non vede le vendite (es. dipendente con la sola chiusura di cassa):
    niente importi attesi né differenze, così il conteggio dei contanti è onesto."""
    cl = out.get("closure")
    return {"date": out["date"], "blind": True,
            "by_method": [{"method_id": m["method_id"], "name": m["name"], "kind": m["kind"]} for m in out["by_method"]],
            "by_channel": [], "totals": {},
            "closure": {"closed_at": cl["closed_at"], "counted": cl["counted"], "notes": cl["notes"]} if cl else None}


class CloseIn(BaseModel):
    counted: dict[str, Decimal | None]
    notes: str | None = None
    adjust_cash: bool = False


@api("POST", "/days/{date}/close", "sales.close_day")
def close_day(ctx: Ctx):
    data = ctx.parse(CloseIn)
    d = dt.date.fromisoformat(ctx.params["date"])
    if d > today():
        raise bad("Non puoi chiudere una giornata futura")
    with db.tx() as c:
        row = svc.close_day(c, ctx.uid, d, data.counted, data.notes, data.adjust_cash)
        audit(c, ctx, "create", "day_closure", d.isoformat(),
              f"Chiusura cassa del {d.strftime('%d/%m/%Y')} – differenza {row['difference']} €", None, row)
    if not ctx.can("sales.view"):
        return {"business_date": row["business_date"], "closed_at": row["closed_at"]}
    return row


@api("DELETE", "/days/{date}/close", "sales.void")
def reopen_day(ctx: Ctx):
    d = dt.date.fromisoformat(ctx.params["date"])
    with db.tx() as c:
        before = c.one("SELECT * FROM day_closures WHERE business_date=%s", [d])
        if not before:
            raise not_found("Chiusura")
        c.exec("DELETE FROM day_closures WHERE business_date=%s", [d])
        audit(c, ctx, "delete", "day_closure", d.isoformat(), f"Riaperta la giornata del {d.strftime('%d/%m/%Y')}", before)
    return {"ok": True}


@api("GET", "/days", ["sales.close_day", "sales.view"])
def list_closures(ctx: Ctx):
    with db.read() as c:
        rows = c.all("SELECT dc.*, u.full_name AS closed_by_name FROM day_closures dc LEFT JOIN users u ON u.id=dc.closed_by "
                      "ORDER BY business_date DESC LIMIT 120")
    if not ctx.can("sales.view"):
        rows = [{"business_date": r["business_date"], "closed_by_name": r["closed_by_name"]} for r in rows]
    return rows
