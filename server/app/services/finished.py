"""Prodotti finiti contati a magazzino: collegamento automatico prodotto ↔ articolo,
produzione del giorno e controllo ammanchi."""
from __future__ import annotations

import datetime as dt
import re
from decimal import Decimal

from .. import db
from ..common import ZERO, D, q2, q4
from ..http import bad
from . import purchasing, recipes, stock

DRINK_WORDS = ("bevand", "bibit", "drink", "bottigl", "lattin", "acqua", "caff")


def _category(c: db.Cursor, name: str) -> int:
    cid = c.val("SELECT id FROM item_categories WHERE lower(name)=lower(%s)", [name])
    return cid or c.val("INSERT INTO item_categories(name) VALUES (%s) RETURNING id", [name])


def _unique_sku(c: db.Cursor, base: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", base.upper()).strip("-")[:20] or "PROD"
    sku, n = f"PF-{base}", 1
    while c.val("SELECT 1 FROM items WHERE lower(sku)=lower(%s)", [sku]):
        n += 1
        sku = f"PF-{base}-{n}"
    return sku


def link_product(c: db.Cursor, uid: int | None, product_id: int) -> dict:
    """Crea l'articolo di magazzino del prodotto finito e collega il prodotto.
    - bevande / prodotti di rivendita → articolo «Rivendita» (si carica con «Ricevi merce»)
    - prodotti fatti in laboratorio   → articolo «Semilavorato» a produzione: la ricetta attuale del prodotto
      (ingredienti) passa all'articolo, e il prodotto scarica 1 pezzo pronto a ogni vendita."""
    p = c.one("SELECT p.*, pc.name AS category_name FROM products p LEFT JOIN product_categories pc ON pc.id=p.category_id "
              "WHERE p.id=%s FOR UPDATE OF p", [product_id])
    if not p:
        raise bad("Prodotto non valido")
    if p["stock_item_id"]:
        return c.one("SELECT * FROM items WHERE id=%s", [p["stock_item_id"]])
    text = f"{p['category_name'] or ''} {p['name']}".lower()
    is_drink = any(w in text for w in DRINK_WORDS)
    v = recipes.version_at(c, product_id=p["id"])
    old_lines = recipes.lines(c, v["id"]) if v else []
    linked = "NOT EXISTS (SELECT 1 FROM products x WHERE x.stock_item_id=i.id)"
    item = None
    # 1) la ricetta è già «1 pezzo/confezione di un articolo» (es. lattina, roll già creato a magazzino)
    if len(old_lines) == 1 and old_lines[0]["item_kind"] in ("rivendita", "semilavorato") and D(old_lines[0]["qty"]) == 1 \
            and old_lines[0]["unit_code"] == old_lines[0]["item_unit"] and old_lines[0]["item_unit"] in ("pz", "conf"):
        item = c.one(f"SELECT * FROM items i WHERE i.id=%s AND {linked}", [old_lines[0]["item_id"]])
    # 2) esiste già un articolo pronto con lo stesso nome del prodotto
    if not item:
        item = c.one(f"""SELECT * FROM items i WHERE lower(trim(i.name))=lower(trim(%s)) AND i.is_active
                          AND i.kind IN ('rivendita','semilavorato') AND i.unit_code IN ('pz','conf') AND {linked}
                          ORDER BY i.id LIMIT 1""", [p["name"]])
    if not item:
        kind = "rivendita" if is_drink else "semilavorato"
        item = c.one(
            """INSERT INTO items(sku,name,kind,category_id,unit_code,semi_mode,vat_rate,notes)
               VALUES (%s,%s,%s,%s,'pz','produzione',%s,%s) RETURNING *""",
            [_unique_sku(c, p["name"]), p["name"], kind, _category(c, "Bevande" if is_drink else "Prodotti pronti"),
             22 if is_drink else 10, "Pezzi pronti del prodotto in vendita (creato automaticamente)"],
        )
    elif item["kind"] == "semilavorato" and item["semi_mode"] != "produzione":
        # deve restare a magazzino come pezzo pronto, non essere scomposto negli ingredienti alla vendita
        c.exec("UPDATE items SET semi_mode='produzione', updated_at=now() WHERE id=%s", [item["id"]])
    others = [l for l in old_lines if l["item_id"] != item["id"]]
    packaging = [l for l in others if l["item_kind"] == "confezione"]
    ingredients = [l for l in others if l["item_kind"] != "confezione"]
    if ingredients and item["kind"] == "semilavorato" and not recipes.version_at(c, item_id=item["id"]):
        recipes.save_version(c, uid, product_id=None, item_id=item["id"], yield_qty=D(v["yield_qty"]), notes="Ricetta del prodotto",
                             valid_from=None, lines_in=[{"item_id": l["item_id"], "qty": l["qty"], "unit_code": l["unit_code"],
                                                         "waste_pct": l["waste_pct"]} for l in ingredients])
    if not (len(old_lines) == 1 and old_lines[0]["item_id"] == item["id"]):
        new_lines = [{"item_id": item["id"], "qty": 1, "unit_code": item["unit_code"]}] + [
            {"item_id": l["item_id"], "qty": D(l["qty"]) / D(v["yield_qty"]), "unit_code": l["unit_code"], "waste_pct": l["waste_pct"]}
            for l in packaging]
        recipes.save_version(c, uid, product_id=p["id"], item_id=None, lines_in=new_lines, yield_qty=1,
                             notes="Collegato al magazzino: ogni vendita scarica 1 pezzo pronto", valid_from=None)
    c.exec("UPDATE products SET stock_item_id=%s, unload_stock=true WHERE id=%s", [item["id"], p["id"]])
    return c.one("SELECT * FROM items WHERE id=%s", [item["id"]])


def produce_batch(c: db.Cursor, uid: int | None, lines: list[dict], at=None, notes: str | None = None) -> list[dict]:
    """Produzione del giorno: per ogni articolo pronto registra la produzione (scarica gli ingredienti se c'è
    la ricetta) oppure un semplice carico dei pezzi."""
    out = []
    for ln in lines:
        qty = q4(ln.get("qty") or 0)
        if qty <= 0:
            continue
        it = c.one("SELECT * FROM items WHERE id=%s", [ln["item_id"]])
        if not it:
            raise bad("Articolo non valido")
        has_recipe = it["kind"] == "semilavorato" and recipes.version_at(c, item_id=it["id"])
        if has_recipe:
            p = purchasing.produce(c, uid, it["id"], qty, notes or "Produzione del giorno", at)
            out.append({"item_id": it["id"], "name": it["name"], "qty": qty, "cost": p["total_cost"], "mode": "produzione"})
        else:
            mv = stock.move(c, uid, it["id"], qty, "carico", at=at, reason=notes or "Produzione del giorno")
            out.append({"item_id": it["id"], "name": it["name"], "qty": qty, "cost": mv["value"], "mode": "carico"})
    if not out:
        raise bad("Inserisci almeno una quantità prodotta")
    return out


def shrinkage(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    """Controllo ammanchi per i prodotti finiti collegati alla cassa:
    iniziale + prodotti/caricati − venduti − sprechi ± differenze d'inventario = finale."""
    T = stock.EFFECTIVE_TYPE_SQL
    rows = c.all(
        f"""SELECT i.id, i.name, i.unit_code, i.qty_on_hand, i.avg_cost,
              (SELECT string_agg(p.name, ', ') FROM products p WHERE p.stock_item_id=i.id) AS products,
              COALESCE(sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date < %s),0) AS opening,
              COALESCE(sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} IN ('produzione_carico','carico','acquisto','giacenza_iniziale')),0) AS produced,
              COALESCE(-sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} = 'consumo_vendita'),0) AS sold,
              COALESCE(-sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} IN ('spreco','scarico','reso_fornitore','produzione_scarico')
                    AND COALESCE(orig.waste_reason, m.waste_reason, '') <> 'omaggio'),0) AS wasted,
              COALESCE(-sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} = 'spreco' AND COALESCE(orig.waste_reason, m.waste_reason) = 'omaggio'),0) AS given,
              COALESCE(sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} = 'rettifica_inventario'),0) AS count_diff,
              COALESCE(sum(m.value) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                    AND {T} = 'rettifica_inventario'),0) AS count_diff_value,
              COALESCE(sum(m.qty) FILTER (WHERE (m.at AT TIME ZONE 'Europe/Rome')::date <= %s),0) AS closing,
              (SELECT max(ic.confirmed_at) FROM inventory_counts ic JOIN inventory_count_lines l ON l.count_id=ic.id
                 WHERE l.item_id=i.id AND ic.status='confermato' AND l.counted_qty IS NOT NULL) AS last_count
           FROM items i LEFT JOIN {stock.MOVES_FROM} ON m.item_id=i.id
           WHERE i.id IN (SELECT stock_item_id FROM products WHERE stock_item_id IS NOT NULL)
           GROUP BY i.id ORDER BY i.name""",
        [d1, d1, d2, d1, d2, d1, d2, d1, d2, d1, d2, d1, d2, d2],
    )
    for r in rows:
        r["missing_qty"] = q4(-D(r["count_diff"])) if D(r["count_diff"]) < 0 else ZERO
        r["surplus_qty"] = q4(D(r["count_diff"])) if D(r["count_diff"]) > 0 else ZERO
        r["missing_value"] = q2(-D(r["count_diff_value"])) if D(r["count_diff_value"]) < 0 else ZERO
        sold = D(r["sold"])
        r["missing_pct"] = q2(r["missing_qty"] / (sold + r["missing_qty"]) * 100) if (sold + r["missing_qty"]) > 0 else ZERO
    return rows


def shrinkage_by_day(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    """Ammanchi rilevati dagli inventari, giorno per giorno e per prodotto."""
    return c.all(
        f"""SELECT (m.at AT TIME ZONE 'Europe/Rome')::date AS day, i.name, i.unit_code, sum(m.qty) AS diff, sum(m.value) AS value,
                   string_agg(DISTINCT u.full_name, ', ') AS counted_by
            FROM {stock.MOVES_FROM} JOIN items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id
            WHERE {stock.EFFECTIVE_TYPE_SQL}='rettifica_inventario' AND (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
              AND i.id IN (SELECT stock_item_id FROM products WHERE stock_item_id IS NOT NULL)
            GROUP BY 1, i.id ORDER BY 1 DESC, i.name""",
        [d1, d2],
    )


def editable_recipe(c: db.Cursor, product: dict) -> dict | None:
    """Per un prodotto collegato a un pezzo pronto con ricetta: ingredienti per 1 pezzo + confezioni,
    così l'editor mostra la ricetta «vera» del prodotto."""
    if not product.get("stock_item_id"):
        return None
    it = c.one("SELECT * FROM items WHERE id=%s", [product["stock_item_id"]])
    if it["kind"] != "semilavorato":
        return None
    iv = recipes.version_at(c, item_id=it["id"])
    pv = recipes.version_at(c, product_id=product["id"])
    out = []
    if iv:
        y = D(iv["yield_qty"])
        out = [{"item_id": l["item_id"], "qty": q4(D(l["qty"]) / y), "unit_code": l["unit_code"], "waste_pct": l["waste_pct"]}
               for l in recipes.lines(c, iv["id"])]
    if pv:
        py = D(pv["yield_qty"])
        out += [{"item_id": l["item_id"], "qty": q4(D(l["qty"]) / py), "unit_code": l["unit_code"], "waste_pct": l["waste_pct"]}
                for l in recipes.lines(c, pv["id"]) if l["item_id"] != it["id"]]
    return {"lines": out, "yield_qty": 1}


def save_product_recipe(c: db.Cursor, uid: int | None, product: dict, lines_in: list[dict], yield_qty, notes, valid_from) -> int:
    """Salva la ricetta di un prodotto. Se il prodotto è contato a magazzino come pezzo pronto, gli ingredienti
    vanno nella ricetta del pezzo pronto e il prodotto continua a scaricare 1 pezzo (+ confezioni)."""
    sid = product.get("stock_item_id")
    if not sid or any(int(l.get("item_id") or 0) == sid for l in lines_in):
        return recipes.save_version(c, uid, product_id=product["id"], item_id=None, lines_in=lines_in, yield_qty=yield_qty,
                                    notes=notes, valid_from=valid_from)
    it = c.one("SELECT * FROM items WHERE id=%s", [sid])
    kinds = {r["id"]: r["kind"] for r in c.all("SELECT id, kind FROM items WHERE id = ANY(%s::int[])",
                                               [[int(l["item_id"]) for l in lines_in if l.get("item_id")]])} if lines_in else {}
    y = D(yield_qty or 1)
    packaging = [l for l in lines_in if kinds.get(int(l.get("item_id") or 0)) == "confezione"]
    ingredients = [l for l in lines_in if l not in packaging]
    if it["kind"] == "semilavorato" and ingredients:
        recipes.save_version(c, uid, product_id=None, item_id=sid, lines_in=ingredients, yield_qty=y, notes=notes,
                             valid_from=valid_from)
    new_lines = [{"item_id": sid, "qty": 1, "unit_code": it["unit_code"]}] + [
        {**l, "qty": D(str(l["qty"]).replace(",", ".")) / y} for l in packaging]
    return recipes.save_version(c, uid, product_id=product["id"], item_id=None, lines_in=new_lines, yield_qty=1,
                                notes=notes, valid_from=valid_from)
