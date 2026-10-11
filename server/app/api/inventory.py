"""Magazzino: articoli, movimenti, inventari fisici, lotti e scadenze."""
import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from .. import db
from ..common import D, parse_ts, setting, today
from ..http import ApiError, Ctx, api, audit, bad, conflict, not_found
from ..services import stock

COST_FIELDS = ("avg_cost", "last_purchase_price", "stock_value", "unit_cost", "value", "avg_cost_after")


def _hide_costs(ctx: Ctx, rows):
    if ctx.can("inventory.costs"):
        return rows
    for r in rows if isinstance(rows, list) else [rows]:
        for f in COST_FIELDS:
            r.pop(f, None)
    return rows


ITEM_SELECT = """
    SELECT i.*, ic.name AS category_name, s.legal_name AS supplier_name,
           GREATEST(i.qty_on_hand,0) * i.avg_cost AS stock_value,
           (i.qty_on_hand <= i.min_qty AND i.min_qty > 0) AS below_min,
           (SELECT min(expiry_date) FROM stock_lots l WHERE l.item_id=i.id AND l.qty_remaining > 0) AS next_expiry
    FROM items i LEFT JOIN item_categories ic ON ic.id=i.category_id LEFT JOIN suppliers s ON s.id=i.default_supplier_id
"""


@api("GET", "/items", "inventory.view")
def list_items(ctx: Ctx):
    where, params = [], []
    if ctx.q("active", "1") == "1":
        where.append("i.is_active")
    if ctx.q("search"):
        where.append("(i.name ILIKE %s OR i.sku ILIKE %s)")
        params += [f"%{ctx.q('search')}%"] * 2
    if ctx.q("category_id"):
        where.append("i.category_id=%s"); params.append(ctx.q("category_id", cast=int))
    if ctx.q("kind"):
        where.append("i.kind=%s"); params.append(ctx.q("kind"))
    if ctx.q("below_min") == "1":
        where.append("i.qty_on_hand <= i.min_qty AND i.min_qty > 0")
    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.name"
    with db.read() as c:
        return _hide_costs(ctx, c.all(sql, params))


@api("GET", "/items/{id}", "inventory.view")
def get_item(ctx: Ctx):
    with db.read() as c:
        it = c.one(ITEM_SELECT + " WHERE i.id=%s", [ctx.pid()])
        if not it:
            raise not_found("Articolo")
        it["lots"] = c.all("SELECT * FROM stock_lots WHERE item_id=%s AND qty_remaining > 0 ORDER BY expiry_date NULLS LAST",
                           [it["id"]])
        it["suppliers"] = c.all(
            "SELECT si.*, s.legal_name FROM supplier_items si JOIN suppliers s ON s.id=si.supplier_id WHERE si.item_id=%s",
            [it["id"]])
        it["used_in"] = c.all(
            """SELECT DISTINCT COALESCE(p.name, i2.name) AS name, rv.product_id, rv.item_id
               FROM recipe_lines rl JOIN recipe_versions rv ON rv.id=rl.recipe_version_id
               LEFT JOIN products p ON p.id=rv.product_id LEFT JOIN items i2 ON i2.id=rv.item_id
               WHERE rl.item_id=%s AND rv.id IN (
                   SELECT DISTINCT ON (COALESCE(product_id,0), COALESCE(item_id,0)) id FROM recipe_versions
                   ORDER BY COALESCE(product_id,0), COALESCE(item_id,0), valid_from DESC, version_no DESC)""",
            [it["id"]])
        return _hide_costs(ctx, it)


class ItemIn(BaseModel):
    sku: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["materia_prima", "semilavorato", "confezione", "rivendita", "consumabile"] = "materia_prima"
    category_id: int | None = None
    description: str | None = None
    unit_code: str
    default_supplier_id: int | None = None
    min_qty: Decimal = Field(default=Decimal(0), ge=0)
    vat_rate: Decimal = Field(default=Decimal(10), ge=0, le=100)
    location: str | None = None
    track_lots: bool = False
    semi_mode: Literal["esplodi", "produzione"] = "esplodi"
    notes: str | None = None
    is_active: bool = True
    # solo in creazione: giacenza iniziale
    initial_qty: Decimal | None = None
    initial_cost: Decimal | None = None
    initial_lot: str | None = None
    initial_expiry: dt.date | None = None
    version: int | None = None


FIELDS = ["sku", "name", "kind", "category_id", "description", "unit_code", "default_supplier_id", "min_qty",
          "vat_rate", "location", "track_lots", "semi_mode", "notes", "is_active"]


@api("POST", "/items", "inventory.edit")
def create_item(ctx: Ctx):
    data = ctx.parse(ItemIn)
    with db.tx() as c:
        row = c.one(
            f"INSERT INTO items({','.join(FIELDS)}) VALUES ({','.join(['%s'] * len(FIELDS))}) RETURNING *",
            [getattr(data, f) for f in FIELDS],
        )
        if data.initial_qty and data.initial_qty > 0:
            ctx.require("inventory.move")
            stock.move(c, ctx.uid, row["id"], data.initial_qty, "giacenza_iniziale",
                       unit_cost=data.initial_cost or 0, reason="Giacenza iniziale",
                       lot_code=data.initial_lot, expiry_date=data.initial_expiry)
        audit(c, ctx, "create", "item", row["id"], f"Nuovo articolo «{row['name']}»", None, row)
    return row


@api("PUT", "/items/{id}", "inventory.edit")
def update_item(ctx: Ctx):
    data = ctx.parse(ItemIn)
    iid = ctx.pid()
    with db.tx() as c:
        before = c.one("SELECT * FROM items WHERE id=%s FOR UPDATE", [iid])
        if not before:
            raise not_found("Articolo")
        if data.version is not None and data.version != before["version"]:
            raise conflict("L'articolo è stato modificato da un altro utente: ricarica la pagina")
        if data.unit_code != before["unit_code"] and c.val("SELECT 1 FROM stock_movements WHERE item_id=%s", [iid]):
            raise bad("Non puoi cambiare l'unità di misura di un articolo con movimenti: crea un nuovo articolo")
        sets = ", ".join(f"{f}=%s" for f in FIELDS)
        row = c.one(f"UPDATE items SET {sets}, updated_at=now(), version=version+1 WHERE id=%s RETURNING *",
                    [getattr(data, f) for f in FIELDS] + [iid])
        audit(c, ctx, "update", "item", iid, f"Articolo «{row['name']}» modificato", before, row)
    return row


@api("GET", "/movements", "inventory.view")
def list_movements(ctx: Ctx):
    where, params = [], []
    if ctx.q("item_id"):
        where.append("m.item_id=%s"); params.append(ctx.q("item_id", cast=int))
    if ctx.q("type"):
        where.append("m.type=%s"); params.append(ctx.q("type"))
    if ctx.qdate("from"):
        where.append("(m.at AT TIME ZONE 'Europe/Rome')::date >= %s"); params.append(ctx.qdate("from"))
    if ctx.qdate("to"):
        where.append("(m.at AT TIME ZONE 'Europe/Rome')::date <= %s"); params.append(ctx.qdate("to"))
    if ctx.q("ref_type"):
        where.append("m.ref_type=%s"); params.append(ctx.q("ref_type"))
    if ctx.q("ref_id"):
        where.append("m.ref_id=%s"); params.append(ctx.q("ref_id", cast=int))
    if ctx.q("consumption") == "1":
        where.append(f"{stock.EFFECTIVE_TYPE_SQL} = ANY(%s::text[])"); params.append(list(stock.CONSUMPTION_TYPES))
    limit = min(ctx.q("limit", 500, int), 5000)
    with db.read() as c:
        rows = c.all(
            f"""SELECT m.*, i.name AS item_name, i.sku, i.unit_code, u.full_name AS user_name,
                       {stock.EFFECTIVE_TYPE_SQL} AS effective_type,
                       EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of=m.id) AS reversed,
                       l.lot_code, l.expiry_date
                FROM {stock.MOVES_FROM} JOIN items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id
                LEFT JOIN stock_lots l ON l.id=m.lot_id
                {'WHERE ' + ' AND '.join(where) if where else ''}
                ORDER BY m.at DESC, m.id DESC LIMIT {limit}""",
            params,
        )
        for r in rows:
            r["type_label"] = stock.TYPE_LABELS.get(r["type"], r["type"])
        return _hide_costs(ctx, rows)


class MoveIn(BaseModel):
    item_id: int
    type: Literal["carico", "acquisto", "scarico", "spreco", "reso_fornitore"]
    qty: Decimal = Field(gt=0)
    qty_unit: str | None = None
    unit_cost: Decimal | None = Field(default=None, ge=0)
    at: str | None = None
    reason: str = Field(min_length=2, max_length=300)
    waste_reason: Literal["danneggiato", "scaduto", "sprecato", "altro"] | None = None
    lot_code: str | None = None
    expiry_date: dt.date | None = None


@api("POST", "/movements", "inventory.move")
def create_movement(ctx: Ctx):
    data = ctx.parse(MoveIn)
    if data.type == "spreco" and not data.waste_reason:
        raise bad("Indica il motivo dello spreco (danneggiato, scaduto, sprecato, altro)")
    with db.tx() as c:
        it = c.one("SELECT * FROM items WHERE id=%s", [data.item_id])
        if not it:
            raise not_found("Articolo")
        qty, cost = D(data.qty), data.unit_cost
        if data.qty_unit and data.qty_unit != it["unit_code"]:
            f = stock.unit_factor(c, data.qty_unit, it["unit_code"])
            qty = qty * f
            cost = D(cost) / f if cost is not None else None
        sign = 1 if data.type in ("carico", "acquisto") else -1
        if data.type == "reso_fornitore":
            cost = cost if cost is not None else None
        mv = stock.move(c, ctx.uid, it["id"], sign * qty, data.type,
                        unit_cost=cost if sign > 0 or data.type == "reso_fornitore" else None,
                        at=parse_ts(data.at), reason=data.reason, waste_reason=data.waste_reason,
                        lot_code=data.lot_code, expiry_date=data.expiry_date)
        audit(c, ctx, "create", "stock_movement", mv["id"],
              f"{stock.TYPE_LABELS[data.type]}: {it['name']} {sign * qty} {it['unit_code']} – {data.reason}")
    return _hide_costs(ctx, mv)


class ReverseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


@api("POST", "/movements/{id}/reverse", "inventory.reverse")
def reverse_movement(ctx: Ctx):
    data = ctx.parse(ReverseIn)
    with db.tx() as c:
        m = c.one("SELECT * FROM stock_movements WHERE id=%s", [ctx.pid()])
        if not m:
            raise not_found("Movimento")
        if m["ref_type"] in ("sale", "goods_receipt", "production", "inventory_count"):
            raise bad("Questo movimento deriva da un documento: annulla il documento di origine")
        mv = stock.reverse(c, ctx.uid, m["id"], data.reason)
        audit(c, ctx, "void", "stock_movement", m["id"], f"Storno movimento #{m['id']}: {data.reason}", m, mv)
    return mv


# ---------------------------------------------------------------- inventari fisici

@api("GET", "/counts", "inventory.view")
def list_counts(ctx: Ctx):
    with db.read() as c:
        return c.all(
            """SELECT ic.*, u.full_name AS created_by_name, (SELECT count(*) FROM inventory_count_lines l WHERE l.count_id=ic.id) AS n_lines,
                      (SELECT count(*) FROM inventory_count_lines l WHERE l.count_id=ic.id AND l.counted_qty IS NOT NULL) AS n_counted
               FROM inventory_counts ic LEFT JOIN users u ON u.id=ic.created_by ORDER BY ic.created_at DESC LIMIT 100""")


class CountIn(BaseModel):
    notes: str | None = None
    category_id: int | None = None
    item_ids: list[int] | None = None


@api("POST", "/counts", "inventory.count")
def create_count(ctx: Ctx):
    data = ctx.parse(CountIn)
    with db.tx() as c:
        if c.val("SELECT 1 FROM inventory_counts WHERE status='bozza'"):
            raise conflict("C'è già un inventario in corso: completalo o annullalo")
        cid = c.val("INSERT INTO inventory_counts(notes,created_by) VALUES (%s,%s) RETURNING id", [data.notes, ctx.uid])
        where, params = ["is_active"], []
        if data.category_id:
            where.append("category_id=%s"); params.append(data.category_id)
        if data.item_ids:
            where.append("id = ANY(%s::int[])"); params.append(data.item_ids)
        c.exec(f"INSERT INTO inventory_count_lines(count_id,item_id) SELECT %s, id FROM items WHERE {' AND '.join(where)}",
               [cid] + params)
        audit(c, ctx, "create", "inventory_count", cid, "Avviato inventario fisico")
    return {"id": cid}


@api("GET", "/counts/{id}", "inventory.view")
def get_count(ctx: Ctx):
    with db.read() as c:
        ic = c.one("SELECT * FROM inventory_counts WHERE id=%s", [ctx.pid()])
        if not ic:
            raise not_found("Inventario")
        ic["lines"] = c.all(
            """SELECT l.*, i.name, i.sku, i.unit_code, i.location, i.qty_on_hand, i.avg_cost, ic.name AS category_name
               FROM inventory_count_lines l JOIN items i ON i.id=l.item_id LEFT JOIN item_categories ic ON ic.id=i.category_id
               WHERE l.count_id=%s ORDER BY ic.name NULLS LAST, i.name""", [ic["id"]])
        if not ctx.can("inventory.costs"):
            for ln in ic["lines"]:
                ln.pop("avg_cost", None)
        return ic


class CountLinesIn(BaseModel):
    lines: list[dict]


@api("PUT", "/counts/{id}", "inventory.count")
def save_count(ctx: Ctx):
    data = ctx.parse(CountLinesIn)
    with db.tx() as c:
        ic = c.one("SELECT * FROM inventory_counts WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not ic or ic["status"] != "bozza":
            raise bad("Inventario non modificabile")
        for ln in data.lines:
            v = ln.get("counted_qty")
            c.exec("UPDATE inventory_count_lines SET counted_qty=%s WHERE count_id=%s AND item_id=%s",
                   [D(v) if v not in (None, "") else None, ic["id"], ln["item_id"]])
    return {"ok": True}


@api("POST", "/counts/{id}/confirm", "inventory.count")
def confirm_count(ctx: Ctx):
    with db.tx() as c:
        ic = c.one("SELECT * FROM inventory_counts WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not ic or ic["status"] != "bozza":
            raise bad("Inventario non confermabile")
        n = 0
        value = Decimal(0)
        for ln in c.all("SELECT * FROM inventory_count_lines WHERE count_id=%s AND counted_qty IS NOT NULL", [ic["id"]]):
            cur = D(c.val("SELECT qty_on_hand FROM items WHERE id=%s FOR UPDATE", [ln["item_id"]]))
            diff = D(ln["counted_qty"]) - cur
            c.exec("UPDATE inventory_count_lines SET expected_qty=%s, difference=%s WHERE id=%s", [cur, diff, ln["id"]])
            if diff != 0:
                mv = stock.move(c, ctx.uid, ln["item_id"], diff, "rettifica_inventario", ref_type="inventory_count",
                                ref_id=ic["id"], reason=f"Inventario fisico #{ic['id']}", allow_negative=True)
                value += D(mv["value"])
                n += 1
        c.exec("UPDATE inventory_counts SET status='confermato', confirmed_by=%s, confirmed_at=now() WHERE id=%s",
               [ctx.uid, ic["id"]])
        audit(c, ctx, "update", "inventory_count", ic["id"],
              f"Inventario #{ic['id']} confermato: {n} rettifiche, valore {value:.2f} €")
    return {"adjustments": n, "value": value}


@api("POST", "/counts/{id}/cancel", "inventory.count")
def cancel_count(ctx: Ctx):
    with db.tx() as c:
        n = c.exec("UPDATE inventory_counts SET status='annullato' WHERE id=%s AND status='bozza'", [ctx.pid()])
        if not n:
            raise bad("Inventario non annullabile")
        audit(c, ctx, "void", "inventory_count", ctx.pid(), "Inventario annullato")
    return {"ok": True}


# ---------------------------------------------------------------- avvisi

@api("GET", "/inventory/alerts", "inventory.view")
def alerts(ctx: Ctx):
    with db.read() as c:
        days = int(setting(c, "expiry_warning_days", 3))
        low = c.all("SELECT id, name, sku, unit_code, qty_on_hand, min_qty FROM items WHERE is_active AND min_qty > 0 "
                    "AND qty_on_hand <= min_qty ORDER BY (qty_on_hand / NULLIF(min_qty,0)), name")
        expiring = c.all(
            """SELECT l.*, i.name, i.unit_code, (l.expiry_date - current_date) AS days_left FROM stock_lots l
               JOIN items i ON i.id=l.item_id WHERE l.qty_remaining > 0 AND l.expiry_date IS NOT NULL
               AND l.expiry_date <= current_date + %s::int ORDER BY l.expiry_date""", [days])
        negative = c.all("SELECT id, name, unit_code, qty_on_hand FROM items WHERE qty_on_hand < 0 ORDER BY name")
        return {"low_stock": low, "expiring": expiring, "negative": negative, "expiry_days": days}
