"""Fornitori, ordini di acquisto, ricevimenti merce."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from .. import db
from ..common import D, q2
from ..http import Ctx, api, audit, bad, conflict, not_found
from ..services import purchasing as svc


# ---------------------------------------------------------------- fornitori

@api("GET", "/suppliers", ["suppliers.view", "purchasing.view", "expenses.view", "inventory.view"])
def list_suppliers(ctx: Ctx):
    where, params = [], []
    if ctx.q("active", "1") == "1":
        where.append("s.is_active")
    if ctx.q("search"):
        where.append("(s.legal_name ILIKE %s OR s.trade_name ILIKE %s OR s.vat_number ILIKE %s)")
        params += [f"%{ctx.q('search')}%"] * 3
    with db.read() as c:
        return c.all(
            f"""SELECT s.*,
                  (SELECT COALESCE(sum(total_amount - paid_amount),0) FROM expenses e WHERE e.supplier_id=s.id AND e.voided_at IS NULL) AS open_balance,
                  (SELECT count(*) FROM supplier_items si WHERE si.supplier_id=s.id) AS n_items
                FROM suppliers s {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY s.legal_name""", params)


@api("GET", "/suppliers/{id}", ["suppliers.view", "purchasing.view"])
def get_supplier(ctx: Ctx):
    with db.read() as c:
        s = c.one("SELECT * FROM suppliers WHERE id=%s", [ctx.pid()])
        if not s:
            raise not_found("Fornitore")
        s["items"] = c.all("""SELECT si.*, i.name, i.sku, i.unit_code FROM supplier_items si JOIN items i ON i.id=si.item_id
                              WHERE si.supplier_id=%s ORDER BY i.name""", [s["id"]])
        if ctx.can("expenses.view"):
            s["expenses"] = c.all("""SELECT id, description, doc_number, doc_date, total_amount, paid_amount, status, due_date
                                     FROM expenses WHERE supplier_id=%s AND voided_at IS NULL ORDER BY doc_date DESC LIMIT 100""",
                                  [s["id"]])
        s["orders"] = c.all("SELECT id, number, order_date, status FROM purchase_orders WHERE supplier_id=%s ORDER BY id DESC LIMIT 50",
                            [s["id"]])
        s["attachments"] = c.all("SELECT id, filename, mime, size_bytes, uploaded_at FROM attachments "
                                 "WHERE owner_type='supplier' AND owner_id=%s", [s["id"]])
        return s


class SupplierIn(BaseModel):
    legal_name: str = Field(min_length=2, max_length=200)
    trade_name: str | None = None
    vat_number: str | None = Field(default=None, max_length=20)
    tax_code: str | None = None
    email: str | None = None
    phone: str | None = None
    contact_person: str | None = None
    address: str | None = None
    city: str | None = None
    zip: str | None = None
    province: str | None = None
    lead_time_days: int | None = Field(default=None, ge=0)
    payment_terms: str | None = None
    payment_days: int | None = Field(default=None, ge=0, le=365)
    notes: str | None = None
    is_active: bool = True


SF = list(SupplierIn.model_fields)


@api("POST", "/suppliers", "suppliers.edit")
def create_supplier(ctx: Ctx):
    data = ctx.parse(SupplierIn)
    with db.tx() as c:
        if data.vat_number and c.val("SELECT 1 FROM suppliers WHERE vat_number=%s", [data.vat_number.strip()]):
            raise conflict("Esiste già un fornitore con questa partita IVA")
        row = c.one(f"INSERT INTO suppliers({','.join(SF)}) VALUES ({','.join(['%s'] * len(SF))}) RETURNING *",
                    [getattr(data, f) for f in SF])
        audit(c, ctx, "create", "supplier", row["id"], f"Nuovo fornitore «{row['legal_name']}»", None, row)
    return row


@api("PUT", "/suppliers/{id}", "suppliers.edit")
def update_supplier(ctx: Ctx):
    data = ctx.parse(SupplierIn)
    with db.tx() as c:
        before = c.one("SELECT * FROM suppliers WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not before:
            raise not_found("Fornitore")
        row = c.one(f"UPDATE suppliers SET {', '.join(f + '=%s' for f in SF)}, updated_at=now() WHERE id=%s RETURNING *",
                    [getattr(data, f) for f in SF] + [ctx.pid()])
        audit(c, ctx, "update", "supplier", row["id"], f"Fornitore «{row['legal_name']}» modificato", before, row)
    return row


class SupplierItemIn(BaseModel):
    item_id: int
    supplier_code: str | None = None
    unit_price: Decimal | None = Field(default=None, ge=0)
    lead_time_days: int | None = None


@api("POST", "/suppliers/{id}/items", "suppliers.edit")
def upsert_supplier_item(ctx: Ctx):
    data = ctx.parse(SupplierItemIn)
    with db.tx() as c:
        c.exec("""INSERT INTO supplier_items(supplier_id,item_id,supplier_code,unit_price,lead_time_days,last_price_at)
                  VALUES (%s,%s,%s,%s,%s,current_date) ON CONFLICT (supplier_id,item_id) DO UPDATE SET
                  supplier_code=EXCLUDED.supplier_code, unit_price=EXCLUDED.unit_price,
                  lead_time_days=EXCLUDED.lead_time_days, last_price_at=current_date""",
               [ctx.pid(), data.item_id, data.supplier_code, data.unit_price, data.lead_time_days])
    return {"ok": True}


@api("DELETE", "/suppliers/{id}/items/{item_id}", "suppliers.edit")
def delete_supplier_item(ctx: Ctx):
    with db.tx() as c:
        c.exec("DELETE FROM supplier_items WHERE supplier_id=%s AND item_id=%s", [ctx.pid(), int(ctx.params["item_id"])])
    return {"ok": True}


# ---------------------------------------------------------------- ordini

@api("GET", "/purchase-orders", "purchasing.view")
def list_pos(ctx: Ctx):
    where, params = [], []
    if ctx.q("status"):
        where.append("po.status=%s"); params.append(ctx.q("status"))
    if ctx.q("supplier_id"):
        where.append("po.supplier_id=%s"); params.append(ctx.q("supplier_id", cast=int))
    with db.read() as c:
        return c.all(
            f"""SELECT po.*, s.legal_name AS supplier_name,
                   (SELECT COALESCE(sum(qty_ordered*unit_price),0) FROM purchase_order_lines l WHERE l.po_id=po.id) AS total_net,
                   (SELECT count(*) FROM purchase_order_lines l WHERE l.po_id=po.id) AS n_lines
                FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
                {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY po.id DESC LIMIT 300""", params)


@api("GET", "/purchase-orders/{id}", "purchasing.view")
def get_po(ctx: Ctx):
    with db.read() as c:
        po = c.one("SELECT po.*, s.legal_name AS supplier_name, s.email AS supplier_email FROM purchase_orders po "
                   "JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=%s", [ctx.pid()])
        if not po:
            raise not_found("Ordine")
        po["lines"] = c.all("""SELECT l.*, i.name, i.sku, i.unit_code, (l.qty_ordered - l.qty_received) AS qty_missing
                               FROM purchase_order_lines l JOIN items i ON i.id=l.item_id WHERE po_id=%s ORDER BY l.id""",
                            [po["id"]])
        po["receipts"] = c.all("SELECT * FROM goods_receipts WHERE po_id=%s ORDER BY id", [po["id"]])
        po["expenses"] = c.all("SELECT id, description, doc_number, total_amount, status FROM expenses "
                               "WHERE po_id=%s AND voided_at IS NULL", [po["id"]])
        return po


class POLineIn(BaseModel):
    item_id: int
    qty_ordered: Decimal = Field(gt=0)
    unit_price: Decimal = Field(default=Decimal(0), ge=0)
    vat_rate: Decimal = Field(default=Decimal(10), ge=0, le=100)


class POIn(BaseModel):
    supplier_id: int
    order_date: dt.date
    expected_date: dt.date | None = None
    notes: str | None = None
    lines: list[POLineIn] = Field(min_length=1)


@api("POST", "/purchase-orders", "purchasing.edit")
def create_po(ctx: Ctx):
    data = ctx.parse(POIn)
    with db.tx() as c:
        num = svc.next_po_number(c)
        pid = c.val("INSERT INTO purchase_orders(number,supplier_id,order_date,expected_date,notes,created_by) "
                    "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                    [num, data.supplier_id, data.order_date, data.expected_date, data.notes, ctx.uid])
        for ln in data.lines:
            c.exec("INSERT INTO purchase_order_lines(po_id,item_id,qty_ordered,unit_price,vat_rate) VALUES (%s,%s,%s,%s,%s)",
                   [pid, ln.item_id, ln.qty_ordered, ln.unit_price, ln.vat_rate])
        audit(c, ctx, "create", "purchase_order", pid, f"Ordine {num} creato")
    return {"id": pid, "number": num}


@api("PUT", "/purchase-orders/{id}", "purchasing.edit")
def update_po(ctx: Ctx):
    data = ctx.parse(POIn)
    with db.tx() as c:
        po = c.one("SELECT * FROM purchase_orders WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not po:
            raise not_found("Ordine")
        if po["status"] not in ("bozza", "inviato"):
            raise bad("Puoi modificare solo ordini in bozza o inviati e non ancora ricevuti")
        if c.val("SELECT 1 FROM purchase_order_lines WHERE po_id=%s AND qty_received > 0", [po["id"]]):
            raise bad("L'ordine ha già ricevimenti registrati")
        c.exec("UPDATE purchase_orders SET supplier_id=%s, order_date=%s, expected_date=%s, notes=%s, updated_at=now() WHERE id=%s",
               [data.supplier_id, data.order_date, data.expected_date, data.notes, po["id"]])
        c.exec("DELETE FROM purchase_order_lines WHERE po_id=%s", [po["id"]])
        for ln in data.lines:
            c.exec("INSERT INTO purchase_order_lines(po_id,item_id,qty_ordered,unit_price,vat_rate) VALUES (%s,%s,%s,%s,%s)",
                   [po["id"], ln.item_id, ln.qty_ordered, ln.unit_price, ln.vat_rate])
        audit(c, ctx, "update", "purchase_order", po["id"], f"Ordine {po['number']} modificato")
    return {"ok": True}


class POStatusIn(BaseModel):
    status: Literal["bozza", "inviato", "chiuso", "annullato"]


@api("POST", "/purchase-orders/{id}/status", "purchasing.edit")
def po_status(ctx: Ctx):
    data = ctx.parse(POStatusIn)
    with db.tx() as c:
        po = c.one("SELECT * FROM purchase_orders WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not po:
            raise not_found("Ordine")
        received = c.val("SELECT COALESCE(sum(qty_received),0) FROM purchase_order_lines WHERE po_id=%s", [po["id"]])
        if data.status == "annullato" and D(received) > 0:
            raise bad("L'ordine ha merce ricevuta: puoi solo chiuderlo")
        if data.status == "bozza" and po["status"] != "inviato":
            raise bad("Transizione di stato non consentita")
        c.exec("UPDATE purchase_orders SET status=%s, updated_at=now() WHERE id=%s", [data.status, po["id"]])
        audit(c, ctx, "update", "purchase_order", po["id"], f"Ordine {po['number']}: stato {po['status']} → {data.status}")
    return {"ok": True}


# ---------------------------------------------------------------- ricevimenti

@api("GET", "/receipts", "purchasing.view")
def list_receipts(ctx: Ctx):
    with db.read() as c:
        rows = c.all(
            """SELECT r.*, s.legal_name AS supplier_name, po.number AS po_number, u.full_name AS user_name,
                      (SELECT COALESCE(sum(qty*unit_cost),0) FROM goods_receipt_lines l WHERE l.receipt_id=r.id) AS total_net,
                      (SELECT count(*) FROM goods_receipt_lines l WHERE l.receipt_id=r.id) AS n_lines,
                      (SELECT id FROM expenses e WHERE e.receipt_id=r.id AND e.voided_at IS NULL LIMIT 1) AS expense_id
               FROM goods_receipts r LEFT JOIN suppliers s ON s.id=r.supplier_id LEFT JOIN purchase_orders po ON po.id=r.po_id
               LEFT JOIN users u ON u.id=r.user_id ORDER BY r.received_at DESC LIMIT 300""")
        if not ctx.can("inventory.costs"):
            for r in rows:
                r.pop("total_net", None)
        return rows


@api("GET", "/receipts/{id}", "purchasing.view")
def get_receipt(ctx: Ctx):
    with db.read() as c:
        r = c.one("SELECT r.*, s.legal_name AS supplier_name FROM goods_receipts r LEFT JOIN suppliers s ON s.id=r.supplier_id "
                  "WHERE r.id=%s", [ctx.pid()])
        if not r:
            raise not_found("Ricevimento")
        r["lines"] = c.all("SELECT l.*, i.name, i.unit_code FROM goods_receipt_lines l JOIN items i ON i.id=l.item_id "
                           "WHERE receipt_id=%s", [r["id"]])
        r["expense"] = c.one("SELECT id, description, total_amount, status FROM expenses WHERE receipt_id=%s AND voided_at IS NULL",
                             [r["id"]])
        return r


@api("POST", "/receipts", "purchasing.receive")
def create_receipt(ctx: Ctx):
    data = ctx.body or {}
    if (data.get("expense") or {}).get("create"):
        ctx.require("expenses.edit")
        if (data.get("expense") or {}).get("paid_now"):
            ctx.require("expenses.pay")
    for ln in data.get("lines") or []:
        try:
            if D(ln.get("qty")) < 0 or D(ln.get("unit_cost") or 0) < 0:
                raise bad("Quantità e costi non possono essere negativi")
        except ValueError:
            raise bad("Quantità o costo non valido")
    with db.tx() as c:
        r = svc.receive(c, ctx.uid, data)
        audit(c, ctx, "create", "goods_receipt", r["id"],
              f"Ricevimento merce {r.get('doc_ref') or ''} – {q2(r['total_net'])} € netti"
              + (f", spesa #{r['expense']['id']} creata" if r.get("expense") else ""))
    return {"id": r["id"], "expense_id": r["expense"]["id"] if r.get("expense") else None, "total_net": r["total_net"]}


@api("POST", "/receipts/{id}/void", "inventory.reverse")
def void_receipt(ctx: Ctx):
    reason = (ctx.body or {}).get("reason") or ""
    if len(reason) < 3:
        raise bad("Indica il motivo dell'annullamento")
    with db.tx() as c:
        r = svc.void_receipt(c, ctx.uid, ctx.pid(), reason)
        audit(c, ctx, "void", "goods_receipt", r["id"], f"Ricevimento annullato: {reason}")
    return {"ok": True}
