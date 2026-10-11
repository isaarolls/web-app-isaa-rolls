"""Spese, pagamenti, allegati, spese ricorrenti, componenti economiche manuali."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field
from starlette.responses import Response

from .. import config, db
from ..common import today
from ..http import Ctx, api, audit, bad, not_found
from ..services import expenses as svc

EXP_LIST = """
    SELECT e.*, ec.name AS category_name, ec.pl_group, ec.is_inventory, s.legal_name AS supplier_name,
           (e.total_amount - e.paid_amount) AS residual,
           (SELECT count(*) FROM attachments a WHERE a.owner_type='expense' AND a.owner_id=e.id) AS n_attachments,
           CASE WHEN e.status<>'pagata' AND e.due_date < current_date THEN true ELSE false END AS overdue
    FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN suppliers s ON s.id=e.supplier_id
"""


@api("GET", "/expenses", "expenses.view")
def list_expenses(ctx: Ctx):
    where, params = ["e.voided_at IS NULL"] if ctx.q("voided") != "1" else ["e.voided_at IS NOT NULL"], []
    datef = "e.doc_date" if ctx.q("date_field") == "doc" else ("e.due_date" if ctx.q("date_field") == "due" else "e.competence_date")
    if ctx.qdate("from"):
        where.append(f"{datef} >= %s"); params.append(ctx.qdate("from"))
    if ctx.qdate("to"):
        where.append(f"{datef} <= %s"); params.append(ctx.qdate("to"))
    for f in ("category_id", "supplier_id"):
        if ctx.q(f):
            where.append(f"e.{f}=%s"); params.append(ctx.q(f, cast=int))
    if ctx.q("pl_group"):
        where.append("ec.pl_group=%s"); params.append(ctx.q("pl_group"))
    if ctx.q("status") == "aperte":
        where.append("e.status<>'pagata'")
    elif ctx.q("status"):
        where.append("e.status=%s"); params.append(ctx.q("status"))
    if ctx.q("overdue") == "1":
        where.append("e.status<>'pagata' AND e.due_date < current_date")
    if ctx.q("due_within"):
        where.append("e.status<>'pagata' AND e.due_date <= current_date + %s::int"); params.append(ctx.q("due_within", cast=int))
    if ctx.q("search"):
        where.append("(e.description ILIKE %s OR e.doc_number ILIKE %s OR s.legal_name ILIKE %s)")
        params += [f"%{ctx.q('search')}%"] * 3
    order = "e.due_date NULLS LAST" if ctx.q("order") == "due" else "e.doc_date DESC, e.id DESC"
    with db.read() as c:
        return c.all(EXP_LIST + " WHERE " + " AND ".join(where) + f" ORDER BY {order} LIMIT 2000", params)


@api("GET", "/expenses/{id}", "expenses.view")
def get_expense(ctx: Ctx):
    with db.read() as c:
        e = c.one(EXP_LIST + " WHERE e.id=%s", [ctx.pid()])
        if not e:
            raise not_found("Spesa")
        e["payments"] = c.all(
            "SELECT p.*, pm.name AS method_name, a.name AS account_name, u.full_name AS user_name FROM expense_payments p "
            "LEFT JOIN payment_methods pm ON pm.id=p.method_id JOIN accounts a ON a.id=p.account_id "
            "LEFT JOIN users u ON u.id=p.user_id WHERE expense_id=%s ORDER BY paid_at, id", [e["id"]])
        e["attachments"] = c.all("SELECT id, filename, mime, size_bytes, uploaded_at FROM attachments "
                                 "WHERE owner_type='expense' AND owner_id=%s ORDER BY id", [e["id"]])
        if e["receipt_id"]:
            e["receipt_lines"] = c.all(
                "SELECT l.*, i.name, i.unit_code FROM goods_receipt_lines l JOIN items i ON i.id=l.item_id WHERE receipt_id=%s",
                [e["receipt_id"]])
        return e


class ExpenseIn(BaseModel):
    description: str = Field(min_length=2, max_length=300)
    category_id: int
    supplier_id: int | None = None
    doc_type: Literal["fattura", "ricevuta", "scontrino", "f24", "busta_paga", "altro"] = "fattura"
    doc_number: str | None = None
    doc_date: dt.date
    competence_date: dt.date | None = None
    net_amount: Decimal | None = None
    vat_rate: Decimal | None = Field(default=None, ge=0, le=100)
    vat_amount: Decimal | None = None
    total_amount: Decimal | None = None
    vat_deductible: bool = True
    due_date: dt.date | None = None
    notes: str | None = None
    paid_now: bool = False
    paid_at: dt.date | None = None
    payment_method_id: int | None = None
    account_id: int | None = None
    version: int | None = None


@api("POST", "/expenses", "expenses.edit")
def create_expense(ctx: Ctx):
    data = ctx.parse(ExpenseIn)
    if data.paid_now:
        ctx.require("expenses.pay")
    with db.tx() as c:
        e = svc.create(c, ctx.uid, data.model_dump())
        audit(c, ctx, "create", "expense", e["id"], f"Spesa «{e['description']}» {e['total_amount']} €", None, e)
    return e


@api("PUT", "/expenses/{id}", "expenses.edit")
def update_expense(ctx: Ctx):
    data = ctx.parse(ExpenseIn)
    with db.tx() as c:
        before, after = svc.update(c, ctx.pid(), data.model_dump(), data.version)
        audit(c, ctx, "update", "expense", after["id"], f"Spesa «{after['description']}» modificata", before, after)
    return after


class ReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@api("POST", "/expenses/{id}/void", "expenses.void")
def void_expense(ctx: Ctx):
    data = ctx.parse(ReasonIn)
    with db.tx() as c:
        e = svc.void(c, ctx.uid, ctx.pid(), data.reason)
        audit(c, ctx, "void", "expense", e["id"], f"Spesa «{e['description']}» annullata: {data.reason}", e)
    return {"ok": True}


class PayIn(BaseModel):
    paid_at: dt.date
    amount: Decimal | None = None
    method_id: int | None = None
    account_id: int | None = None
    notes: str | None = None


@api("POST", "/expenses/{id}/payments", "expenses.pay")
def pay_expense(ctx: Ctx):
    data = ctx.parse(PayIn)
    with db.tx() as c:
        p = svc.add_payment(c, ctx.uid, ctx.pid(), data.model_dump())
        audit(c, ctx, "create", "expense_payment", p["id"], f"Pagamento di {p['amount']} € sulla spesa #{ctx.pid()}", None, p)
    return p


@api("POST", "/expense-payments/{id}/void", "expenses.void")
def void_payment(ctx: Ctx):
    with db.tx() as c:
        p = svc.void_payment(c, ctx.uid, ctx.pid())
        audit(c, ctx, "void", "expense_payment", p["id"], f"Pagamento di {p['amount']} € annullato", p)
    return {"ok": True}


# ---------------------------------------------------------------- allegati

ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
OWNER_PERMS = {"expense": ("expenses.view", "expenses.edit"), "supplier": ("suppliers.view", "suppliers.edit"),
               "goods_receipt": ("purchasing.view", "purchasing.receive"), "purchase_order": ("purchasing.view", "purchasing.edit")}


@api("POST", "/attachments/{owner_type}/{owner_id}")
def upload(ctx: Ctx):
    ot = ctx.params["owner_type"]
    if ot not in OWNER_PERMS:
        raise not_found()
    ctx.require(OWNER_PERMS[ot][1])
    f = ctx.files.get("file")
    if not f:
        raise bad("Nessun file ricevuto")
    data = f["data"]
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise bad(f"File troppo grande (massimo {config.MAX_UPLOAD_MB} MB)")
    mime = (f["content_type"] or "").lower()
    head = data[:12]
    sniff_ok = head.startswith(b"%PDF") or head[:3] == b"\xff\xd8\xff" or head.startswith(b"\x89PNG") or \
        head[8:12] == b"WEBP" or head[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc")
    if mime not in ALLOWED_MIME or not sniff_ok:
        raise bad("Formato non ammesso: carica un PDF o un'immagine (JPG, PNG, WEBP, HEIC)")
    name = (f["filename"] or "documento").replace("/", "_").replace("\\", "_")[:150]
    with db.tx() as c:
        aid = c.val("INSERT INTO attachments(owner_type,owner_id,filename,mime,size_bytes,content,uploaded_by) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                    [ot, int(ctx.params["owner_id"]), name, mime, len(data), data, ctx.uid])
        audit(c, ctx, "create", "attachment", aid, f"Allegato «{name}» caricato su {ot} #{ctx.params['owner_id']}")
    return {"id": aid, "filename": name}


@api("GET", "/attachments/{id}")
def download(ctx: Ctx):
    with db.read() as c:
        a = c.one("SELECT * FROM attachments WHERE id=%s", [ctx.pid()])
    if not a:
        raise not_found("Allegato")
    ctx.require(OWNER_PERMS[a["owner_type"]][0])
    disp = "inline" if ctx.q("inline") == "1" else "attachment"
    from urllib.parse import quote
    return Response(a["content"], media_type=a["mime"], headers={
        "Content-Disposition": f"{disp}; filename*=UTF-8''{quote(a['filename'])}",
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    })


@api("DELETE", "/attachments/{id}")
def delete_attachment(ctx: Ctx):
    with db.tx() as c:
        a = c.one("SELECT id, owner_type, owner_id, filename FROM attachments WHERE id=%s", [ctx.pid()])
        if not a:
            raise not_found("Allegato")
        ctx.require(OWNER_PERMS[a["owner_type"]][1])
        c.exec("DELETE FROM attachments WHERE id=%s", [a["id"]])
        audit(c, ctx, "delete", "attachment", a["id"], f"Allegato «{a['filename']}» eliminato", a)
    return {"ok": True}


# ---------------------------------------------------------------- ricorrenti

@api("GET", "/recurring", "expenses.view")
def list_recurring(ctx: Ctx):
    with db.read() as c:
        return c.all("""SELECT r.*, ec.name AS category_name, s.legal_name AS supplier_name FROM recurring_expenses r
                        JOIN expense_categories ec ON ec.id=r.category_id LEFT JOIN suppliers s ON s.id=r.supplier_id
                        ORDER BY r.is_active DESC, r.description""")


class RecurringIn(BaseModel):
    description: str = Field(min_length=2, max_length=200)
    category_id: int
    supplier_id: int | None = None
    net_amount: Decimal = Field(gt=0)
    vat_rate: Decimal = Field(default=Decimal(0), ge=0, le=100)
    vat_deductible: bool = True
    frequency: Literal["mensile", "bimestrale", "trimestrale", "semestrale", "annuale"]
    day_of_month: int = Field(default=1, ge=1, le=28)
    start_date: dt.date
    end_date: dt.date | None = None
    due_days: int = Field(default=0, ge=0, le=365)
    is_active: bool = True
    notes: str | None = None


RF = list(RecurringIn.model_fields)


@api("POST", "/recurring", "expenses.edit")
def create_recurring(ctx: Ctx):
    data = ctx.parse(RecurringIn)
    with db.tx() as c:
        rid = c.val(f"INSERT INTO recurring_expenses({','.join(RF)}) VALUES ({','.join(['%s'] * len(RF))}) RETURNING id",
                    [getattr(data, f) for f in RF])
        n = svc.generate_recurring(c)
        audit(c, ctx, "create", "recurring_expense", rid, f"Spesa ricorrente «{data.description}» ({n} scadenze generate)")
    return {"id": rid, "generated": n}


@api("PUT", "/recurring/{id}", "expenses.edit")
def update_recurring(ctx: Ctx):
    data = ctx.parse(RecurringIn)
    with db.tx() as c:
        before = c.one("SELECT * FROM recurring_expenses WHERE id=%s", [ctx.pid()])
        if not before:
            raise not_found()
        c.exec(f"UPDATE recurring_expenses SET {', '.join(f + '=%s' for f in RF)} WHERE id=%s",
               [getattr(data, f) for f in RF] + [ctx.pid()])
        n = svc.generate_recurring(c)
        audit(c, ctx, "update", "recurring_expense", ctx.pid(), f"Spesa ricorrente «{data.description}» modificata", before,
              data.model_dump())
    return {"ok": True, "generated": n}


@api("POST", "/recurring/generate", "expenses.edit")
def run_recurring(ctx: Ctx):
    with db.tx() as c:
        n = svc.generate_recurring(c)
    return {"generated": n}


# ---------------------------------------------------------------- componenti economiche manuali

@api("GET", "/economic-entries", "reports.view")
def list_entries(ctx: Ctx):
    with db.read() as c:
        return c.all("SELECT e.*, u.full_name AS user_name FROM economic_entries e LEFT JOIN users u ON u.id=e.user_id "
                     "WHERE voided_at IS NULL ORDER BY entry_date DESC LIMIT 500")


class EntryIn(BaseModel):
    entry_date: dt.date
    pl_group: Literal["altri_ricavi", "costi_variabili", "costi_fissi", "personale", "altri_operativi",
                      "oneri_finanziari", "imposte", "altre_componenti"]
    amount: Decimal
    description: str = Field(min_length=2, max_length=300)


@api("POST", "/economic-entries", "expenses.edit")
def create_entry(ctx: Ctx):
    data = ctx.parse(EntryIn)
    with db.tx() as c:
        eid = c.val("INSERT INTO economic_entries(entry_date,pl_group,amount,description,user_id) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    [data.entry_date, data.pl_group, data.amount, data.description, ctx.uid])
        audit(c, ctx, "create", "economic_entry", eid, f"Componente economica: {data.description} {data.amount} €")
    return {"id": eid}


@api("POST", "/economic-entries/{id}/void", "expenses.void")
def void_entry(ctx: Ctx):
    with db.tx() as c:
        n = c.exec("UPDATE economic_entries SET voided_at=now() WHERE id=%s AND voided_at IS NULL", [ctx.pid()])
        if not n:
            raise not_found()
        audit(c, ctx, "void", "economic_entry", ctx.pid(), "Componente economica annullata")
    return {"ok": True}
