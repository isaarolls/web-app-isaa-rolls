"""Ricette (distinte base) con versioni, calcolo costi e scarico ingredienti."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from .. import db
from ..common import ZERO, D, q2, q6, setting
from ..http import bad
from . import stock

MAX_DEPTH = 6


def version_at(c: db.Cursor, *, product_id: int | None = None, item_id: int | None = None,
               at: dt.datetime | None = None) -> dict | None:
    col, val = ("product_id", product_id) if product_id else ("item_id", item_id)
    return c.one(
        f"SELECT * FROM recipe_versions WHERE {col}=%s AND valid_from <= COALESCE(%s::timestamptz, now()) "
        "ORDER BY valid_from DESC, version_no DESC LIMIT 1",
        [val, at],
    )


def lines(c: db.Cursor, version_id: int) -> list[dict]:
    return c.all(
        """SELECT rl.*, i.name AS item_name, i.sku, i.kind AS item_kind, i.unit_code AS item_unit,
                  i.avg_cost, i.last_purchase_price, i.semi_mode
           FROM recipe_lines rl JOIN items i ON i.id = rl.item_id
           WHERE rl.recipe_version_id = %s ORDER BY rl.sort_order, rl.id""",
        [version_id],
    )


def item_unit_cost(c: db.Cursor, item: dict, depth: int = 0) -> tuple[Decimal, bool]:
    """Costo unitario (per unità di magazzino) usato nei calcoli teorici. Ritorna (costo, stimato)."""
    if item.get("item_kind", item.get("kind")) == "semilavorato" and item.get("semi_mode") == "esplodi":
        v = version_at(c, item_id=item["item_id"] if "item_id" in item else item["id"])
        if v and depth < MAX_DEPTH:
            card = cost_of_version(c, v, depth + 1)
            return card["unit_cost"], card["missing_costs"] > 0
    avg = D(item.get("avg_cost"))
    if avg > 0:
        return avg, False
    lp = D(item.get("last_purchase_price"))
    return lp, lp == 0


def cost_of_version(c: db.Cursor, version: dict, depth: int = 0) -> dict:
    """Scheda costo di una versione di ricetta, per 1 unità di resa."""
    if depth > MAX_DEPTH:
        raise bad("Ricetta con riferimenti circolari")
    out_lines = []
    materials = packaging = ZERO
    missing = 0
    for ln in lines(c, version["id"]):
        q_stock = stock.convert(c, ln["qty"], ln["unit_code"], ln["item_unit"])
        q_eff = q_stock / (1 - D(ln["waste_pct"]) / 100)
        uc, estimated = item_unit_cost(c, ln, depth)
        cost = q_eff * uc
        if uc == 0:
            missing += 1
        if ln["item_kind"] == "confezione":
            packaging += cost
        else:
            materials += cost
        out_lines.append({
            "id": ln["id"], "item_id": ln["item_id"], "item_name": ln["item_name"], "sku": ln["sku"],
            "item_kind": ln["item_kind"], "qty": ln["qty"], "unit_code": ln["unit_code"],
            "waste_pct": ln["waste_pct"], "item_unit": ln["item_unit"], "qty_stock_unit": q6(q_eff),
            "unit_cost": q6(uc), "line_cost": q6(cost), "cost_missing": uc == 0,
        })
    y = D(version["yield_qty"])
    return {
        "version_id": version["id"], "version_no": version["version_no"], "valid_from": version["valid_from"],
        "yield_qty": y, "lines": out_lines,
        "materials_cost": q6(materials / y), "packaging_cost": q6(packaging / y),
        "unit_cost": q6((materials + packaging) / y), "missing_costs": missing,
    }


def product_card(c: db.Cursor, product: dict, at: dt.datetime | None = None) -> dict:
    """Costi, margini e prezzo consigliato di un prodotto di vendita."""
    v = version_at(c, product_id=product["id"], at=at)
    price = D(product["sale_price"])
    vat = D(product["vat_rate"])
    net_price = price / (1 + vat / 100) if price else ZERO
    target = D(product["target_margin_pct"]) if product.get("target_margin_pct") is not None \
        else D(setting(c, "default_target_margin_pct", 70))
    card = cost_of_version(c, v) if v else None
    unit_cost = card["unit_cost"] if card else ZERO
    margin = net_price - unit_cost
    suggested_net = unit_cost / (1 - target / 100) if target < 100 and unit_cost > 0 else ZERO
    return {
        "has_recipe": bool(v),
        "recipe": card,
        "sale_price": price,
        "net_price": q2(net_price),
        "materials_cost": card["materials_cost"] if card else ZERO,
        "packaging_cost": card["packaging_cost"] if card else ZERO,
        "unit_cost": unit_cost,
        "gross_margin": q2(margin),
        "gross_margin_pct": q2(margin / net_price * 100) if net_price else None,
        "food_cost_pct": q2(unit_cost / net_price * 100) if net_price else None,
        "target_margin_pct": target,
        "suggested_price": q2(suggested_net * (1 + vat / 100)) if suggested_net else None,
        "missing_costs": card["missing_costs"] if card else 0,
    }


def explode(c: db.Cursor, version_id: int, multiplier, depth: int = 0) -> dict[int, Decimal]:
    """Quantità di ogni articolo da scaricare (in unità di magazzino) per `multiplier` unità di resa.
    I semilavorati in modalità 'esplodi' vengono scomposti nei loro ingredienti."""
    if depth > MAX_DEPTH:
        raise bad("Ricetta con riferimenti circolari")
    v = c.one("SELECT * FROM recipe_versions WHERE id=%s", [version_id])
    per = D(multiplier) / D(v["yield_qty"])
    need: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for ln in lines(c, version_id):
        q = stock.convert(c, ln["qty"], ln["unit_code"], ln["item_unit"]) / (1 - D(ln["waste_pct"]) / 100) * per
        if ln["item_kind"] == "semilavorato" and ln["semi_mode"] == "esplodi":
            sub = version_at(c, item_id=ln["item_id"])
            if sub:
                for k, qq in explode(c, sub["id"], q, depth + 1).items():
                    need[k] += qq
                continue
        need[ln["item_id"]] += q
    return dict(need)


def save_version(c: db.Cursor, uid: int | None, *, product_id: int | None, item_id: int | None,
                 lines_in: list[dict], yield_qty, notes: str | None, valid_from: dt.datetime | None) -> int:
    """Crea una NUOVA versione della ricetta (le precedenti restano per lo storico)."""
    if not lines_in:
        raise bad("La ricetta deve contenere almeno un ingrediente")
    col, val = ("product_id", product_id) if product_id else ("item_id", item_id)
    last = c.val(f"SELECT max(version_no) FROM recipe_versions WHERE {col}=%s", [val]) or 0
    if valid_from is None and last == 0:
        # la prima versione vale anche per le registrazioni retrodatate
        import datetime as _dt
        valid_from = _dt.datetime(2000, 1, 1, tzinfo=_dt.timezone.utc)
    if valid_from is not None:
        latest_from = c.val(f"SELECT max(valid_from) FROM recipe_versions WHERE {col}=%s", [val])
        if latest_from and valid_from < latest_from:
            raise bad("La data di validità non può precedere quella dell'ultima versione")
    vid = c.val(
        "INSERT INTO recipe_versions(product_id,item_id,version_no,valid_from,yield_qty,notes,created_by) "
        "VALUES (%s,%s,%s,COALESCE(%s::timestamptz, now()),%s,%s,%s) RETURNING id",
        [product_id, item_id, last + 1, valid_from, D(yield_qty or 1), notes, uid],
    )
    for i, ln in enumerate(lines_in):
        it = c.one("SELECT id, unit_code, kind FROM items WHERE id=%s", [ln["item_id"]])
        if not it:
            raise bad("Ingrediente inesistente")
        if item_id and ln["item_id"] == item_id:
            raise bad("Un semilavorato non può contenere sé stesso")
        unit = ln.get("unit_code") or it["unit_code"]
        stock.unit_factor(c, unit, it["unit_code"])  # verifica compatibilità
        c.exec(
            "INSERT INTO recipe_lines(recipe_version_id,item_id,qty,unit_code,waste_pct,sort_order) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            [vid, ln["item_id"], D(ln["qty"]), unit, D(ln.get("waste_pct") or 0), i],
        )
    # verifica assenza di cicli
    explode(c, vid, 1)
    return vid
