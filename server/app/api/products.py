"""Prodotti di vendita, ricette (con versioni), schede costo, produzione semilavorati."""
from decimal import Decimal

from pydantic import BaseModel, Field

from .. import db
from ..common import parse_ts
from ..http import Ctx, api, audit, bad, conflict, not_found
from ..services import purchasing, recipes, stock

CARD_COST_KEYS = ("materials_cost", "packaging_cost", "unit_cost", "gross_margin", "gross_margin_pct",
                  "food_cost_pct", "suggested_price", "recipe")


def _strip(ctx, card):
    if not ctx.can("products.costs"):
        for k in CARD_COST_KEYS:
            card.pop(k, None)
    return card


@api("GET", "/products", ["products.view", "sales.create"])
def list_products(ctx: Ctx):
    where = ["p.is_active"] if ctx.q("active", "1") == "1" else []
    params = []
    if ctx.q("search"):
        where.append("(p.name ILIKE %s OR p.code ILIKE %s)"); params += [f"%{ctx.q('search')}%"] * 2
    with db.read() as c:
        rows = c.all(
            f"""SELECT p.*, pc.name AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id
                {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY pc.sort_order NULLS LAST, p.sort_order, p.name""",
            params)
        if ctx.q("with_cost") == "1" and ctx.can("products.view"):
            for p in rows:
                card = recipes.product_card(c, p)
                card.pop("recipe", None)
                p["card"] = _strip(ctx, card)
        return rows


@api("GET", "/products/{id}", "products.view")
def get_product(ctx: Ctx):
    with db.read() as c:
        p = c.one("SELECT p.*, pc.name AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id "
                  "WHERE p.id=%s", [ctx.pid()])
        if not p:
            raise not_found("Prodotto")
        p["card"] = _strip(ctx, recipes.product_card(c, p))
        p["versions"] = c.all(
            "SELECT rv.*, u.full_name AS created_by_name FROM recipe_versions rv LEFT JOIN users u ON u.id=rv.created_by "
            "WHERE product_id=%s ORDER BY version_no DESC", [p["id"]])
        return p


class ProductIn(BaseModel):
    code: str | None = None
    name: str = Field(min_length=1, max_length=160)
    category_id: int | None = None
    description: str | None = None
    sale_price: Decimal = Field(ge=0)
    vat_rate: Decimal = Field(default=Decimal(10), ge=0, le=100)
    target_margin_pct: Decimal | None = Field(default=None, ge=0, lt=100)
    unload_stock: bool = True
    is_active: bool = True
    sort_order: int = 0
    color: str | None = None
    version: int | None = None


PFIELDS = ["code", "name", "category_id", "description", "sale_price", "vat_rate", "target_margin_pct", "unload_stock",
           "is_active", "sort_order", "color"]


@api("POST", "/products", "products.edit")
def create_product(ctx: Ctx):
    data = ctx.parse(ProductIn)
    with db.tx() as c:
        row = c.one(f"INSERT INTO products({','.join(PFIELDS)}) VALUES ({','.join(['%s'] * len(PFIELDS))}) RETURNING *",
                    [getattr(data, f) or (None if f == "code" else getattr(data, f)) for f in PFIELDS])
        audit(c, ctx, "create", "product", row["id"], f"Nuovo prodotto «{row['name']}»", None, row)
    return row


@api("PUT", "/products/{id}", "products.edit")
def update_product(ctx: Ctx):
    data = ctx.parse(ProductIn)
    pid = ctx.pid()
    with db.tx() as c:
        before = c.one("SELECT * FROM products WHERE id=%s FOR UPDATE", [pid])
        if not before:
            raise not_found("Prodotto")
        if data.version is not None and data.version != before["version"]:
            raise conflict("Il prodotto è stato modificato da un altro utente: ricarica la pagina")
        sets = ", ".join(f"{f}=%s" for f in PFIELDS)
        row = c.one(f"UPDATE products SET {sets}, updated_at=now(), version=version+1 WHERE id=%s RETURNING *",
                    [getattr(data, f) if f != "code" else (data.code or None) for f in PFIELDS] + [pid])
        audit(c, ctx, "update", "product", pid, f"Prodotto «{row['name']}» modificato", before, row)
    return row


class RecipeIn(BaseModel):
    lines: list[dict]
    yield_qty: Decimal = Field(default=Decimal(1), gt=0)
    notes: str | None = None
    valid_from: str | None = None


@api("POST", "/products/{id}/recipe", "products.edit")
def save_product_recipe(ctx: Ctx):
    data = ctx.parse(RecipeIn)
    pid = ctx.pid()
    with db.tx() as c:
        p = c.one("SELECT * FROM products WHERE id=%s", [pid])
        if not p:
            raise not_found("Prodotto")
        vid = recipes.save_version(c, ctx.uid, product_id=pid, item_id=None, lines_in=data.lines,
                                   yield_qty=data.yield_qty, notes=data.notes, valid_from=parse_ts(data.valid_from))
        card = recipes.product_card(c, p)
        audit(c, ctx, "create", "recipe", vid, f"Nuova versione ricetta «{p['name']}»", None,
              {"lines": data.lines, "unit_cost": card["unit_cost"]})
    return {"version_id": vid, "card": _strip(ctx, card)}


@api("GET", "/recipe-versions/{id}", "products.view")
def get_version(ctx: Ctx):
    with db.read() as c:
        v = c.one("SELECT * FROM recipe_versions WHERE id=%s", [ctx.pid()])
        if not v:
            raise not_found("Ricetta")
        card = recipes.cost_of_version(c, v)
        if not ctx.can("products.costs"):
            for ln in card["lines"]:
                for k in ("unit_cost", "line_cost"):
                    ln.pop(k, None)
            for k in ("materials_cost", "packaging_cost", "unit_cost"):
                card.pop(k, None)
        return card


@api("POST", "/products/preview-cost", "products.costs")
def preview_cost(ctx: Ctx):
    """Calcolo del costo di una ricetta non ancora salvata (anteprima nell'editor)."""
    data = ctx.parse(RecipeIn)
    body = ctx.body or {}
    with db.tx() as c:
        # si usa una versione temporanea annullata con ROLLBACK
        c.exec("SAVEPOINT preview")
        tmp = c.val("INSERT INTO products(name,sale_price,vat_rate) VALUES ('__anteprima__',%s,%s) RETURNING id",
                    [Decimal(str(body.get("sale_price") or 0)), Decimal(str(body.get("vat_rate") or 10))])
        c.exec("UPDATE products SET target_margin_pct=%s WHERE id=%s",
               [body.get("target_margin_pct") if body.get("target_margin_pct") not in (None, "") else None, tmp])
        recipes.save_version(c, ctx.uid, product_id=tmp, item_id=None, lines_in=data.lines, yield_qty=data.yield_qty,
                             notes=None, valid_from=None)
        p = c.one("SELECT * FROM products WHERE id=%s", [tmp])
        card = recipes.product_card(c, p)
        c.exec("ROLLBACK TO SAVEPOINT preview")
    return card


# ---------------------------------------------------------------- semilavorati

@api("GET", "/items/{id}/recipe", "products.view")
def get_item_recipe(ctx: Ctx):
    with db.read() as c:
        it = c.one("SELECT * FROM items WHERE id=%s", [ctx.pid()])
        if not it:
            raise not_found("Articolo")
        v = recipes.version_at(c, item_id=it["id"])
        return {"item": it, "recipe": recipes.cost_of_version(c, v) if v else None,
                "versions": c.all("SELECT * FROM recipe_versions WHERE item_id=%s ORDER BY version_no DESC", [it["id"]])}


@api("POST", "/items/{id}/recipe", "products.edit")
def save_item_recipe(ctx: Ctx):
    data = ctx.parse(RecipeIn)
    iid = ctx.pid()
    with db.tx() as c:
        it = c.one("SELECT * FROM items WHERE id=%s", [iid])
        if not it or it["kind"] != "semilavorato":
            raise bad("Le ricette di magazzino sono solo per i semilavorati")
        vid = recipes.save_version(c, ctx.uid, product_id=None, item_id=iid, lines_in=data.lines,
                                   yield_qty=data.yield_qty, notes=data.notes, valid_from=parse_ts(data.valid_from))
        audit(c, ctx, "create", "recipe", vid, f"Nuova versione ricetta semilavorato «{it['name']}»")
    return {"version_id": vid}


class ProduceIn(BaseModel):
    item_id: int
    qty: Decimal = Field(gt=0)
    notes: str | None = None
    at: str | None = None


@api("POST", "/productions", "production.create")
def create_production(ctx: Ctx):
    data = ctx.parse(ProduceIn)
    with db.tx() as c:
        p = purchasing.produce(c, ctx.uid, data.item_id, data.qty, data.notes, data.at)
        audit(c, ctx, "create", "production", p["id"], f"Produzione registrata: {data.qty}")
    return p


@api("GET", "/productions", "inventory.view")
def list_productions(ctx: Ctx):
    with db.read() as c:
        return c.all(
            """SELECT p.*, i.name AS item_name, i.unit_code, u.full_name AS user_name FROM productions p
               JOIN items i ON i.id=p.item_id LEFT JOIN users u ON u.id=p.user_id ORDER BY p.produced_at DESC LIMIT 200""")


@api("POST", "/productions/{id}/void", "inventory.reverse")
def void_production(ctx: Ctx):
    reason = (ctx.body or {}).get("reason") or "Annullata"
    with db.tx() as c:
        p = c.one("SELECT * FROM productions WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not p or p["voided_at"]:
            raise bad("Produzione non valida")
        stock.reverse_ref(c, ctx.uid, "production", p["id"], f"Annullamento produzione: {reason}")
        c.exec("UPDATE productions SET voided_at=now(), voided_by=%s, void_reason=%s WHERE id=%s", [ctx.uid, reason, p["id"]])
        audit(c, ctx, "void", "production", p["id"], f"Produzione annullata: {reason}")
    return {"ok": True}
