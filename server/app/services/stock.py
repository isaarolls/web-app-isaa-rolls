"""Motore del magazzino.

Regole:
- Ogni variazione di quantità passa da `move()`: crea un movimento immutabile e aggiorna
  giacenza e costo medio dell'articolo NELLA STESSA TRANSAZIONE, con lock di riga (FOR UPDATE).
- Valorizzazione a costo medio ponderato (netto IVA).
- Le correzioni si fanno con uno storno (`reverse()`), mai modificando i movimenti.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from .. import db
from ..common import ZERO, D, q4, q6, setting
from ..http import ApiError, bad

INFLOW_TYPES = {"giacenza_iniziale", "acquisto", "carico", "reso_fornitore"}
# tipi il cui valore costituisce "consumo" (costo delle materie prime nel conto economico)
CONSUMPTION_TYPES = {"scarico", "consumo_vendita", "spreco", "rettifica_inventario",
                     "produzione_scarico", "produzione_carico"}

TYPE_LABELS = {
    "giacenza_iniziale": "Giacenza iniziale", "acquisto": "Acquisto", "carico": "Carico",
    "produzione_carico": "Produzione (carico)", "scarico": "Scarico / consumo",
    "consumo_vendita": "Consumo da vendita", "produzione_scarico": "Produzione (consumo ingredienti)",
    "spreco": "Spreco / danneggiato / scaduto", "rettifica_inventario": "Rettifica da inventario",
    "reso_fornitore": "Reso a fornitore", "storno": "Storno",
}

# SQL riutilizzabile: tipo "effettivo" (gli storni ereditano il tipo del movimento stornato)
EFFECTIVE_TYPE_SQL = "COALESCE(orig.type, m.type)"
MOVES_FROM = "stock_movements m LEFT JOIN stock_movements orig ON orig.id = m.reversal_of"


def unit_factor(c: db.Cursor, from_unit: str, to_unit: str) -> Decimal:
    if from_unit == to_unit:
        return Decimal(1)
    a = c.one("SELECT dimension, factor FROM units WHERE code=%s", [from_unit])
    b = c.one("SELECT dimension, factor FROM units WHERE code=%s", [to_unit])
    if not a or not b:
        raise bad("Unità di misura sconosciuta")
    if a["dimension"] != b["dimension"]:
        raise bad(f"Unità non compatibili: {from_unit} → {to_unit}")
    return D(a["factor"]) / D(b["factor"])


def convert(c: db.Cursor, qty, from_unit: str, to_unit: str) -> Decimal:
    return D(qty) * unit_factor(c, from_unit, to_unit)


def move(
    c: db.Cursor,
    uid: int | None,
    item_id: int,
    qty,
    type: str,
    unit_cost=None,
    at: dt.datetime | None = None,
    reason: str | None = None,
    waste_reason: str | None = None,
    ref_type: str | None = None,
    ref_id: int | None = None,
    lot_code: str | None = None,
    expiry_date: dt.date | None = None,
    reversal_of: int | None = None,
    allow_negative: bool | None = None,
) -> dict:
    qty = q4(qty)
    if qty == 0:
        raise bad("La quantità non può essere zero")
    it = c.one("SELECT * FROM items WHERE id=%s FOR UPDATE", [item_id])
    if not it:
        raise bad("Articolo inesistente")
    qb, avg = D(it["qty_on_hand"]), D(it["avg_cost"])
    qa = qb + qty

    if qty > 0:
        if unit_cost is None:
            unit_cost = avg if avg > 0 else D(it["last_purchase_price"] or 0)
        uc = q6(unit_cost)
        if uc < 0:
            raise bad("Il costo non può essere negativo")
        if qb <= 0 or qa <= 0:
            new_avg = uc
        else:
            new_avg = q6((qb * avg + qty * uc) / qa)
    else:
        if unit_cost is None:
            uc = avg
            new_avg = avg
        else:
            # uscita a costo specifico (storno di un carico, reso a fornitore): ricalcola il medio
            uc = q6(unit_cost)
            new_avg = q6((qb * avg + qty * uc) / qa) if qa > 0 else avg
            if new_avg < 0:
                new_avg = avg
        if allow_negative is None:
            allow_negative = bool(setting(c, "allow_negative_stock", True))
        if qa < 0 and not allow_negative:
            raise ApiError(409, f"Giacenza insufficiente per «{it['name']}»: disponibili {qb.normalize()} {it['unit_code']}")

    lot_id = None
    if it["track_lots"]:
        if qty > 0 and (lot_code or expiry_date):
            lot = c.one(
                "SELECT id FROM stock_lots WHERE item_id=%s AND lot_code IS NOT DISTINCT FROM %s "
                "AND expiry_date IS NOT DISTINCT FROM %s",
                [item_id, lot_code or None, expiry_date],
            )
            lot_id = lot["id"] if lot else c.val(
                "INSERT INTO stock_lots(item_id,lot_code,expiry_date) VALUES (%s,%s,%s) RETURNING id",
                [item_id, lot_code or None, expiry_date],
            )
            c.exec("UPDATE stock_lots SET qty_remaining = qty_remaining + %s WHERE id=%s", [qty, lot_id])
        elif qty < 0:
            remaining = -qty
            for lot in c.all(
                "SELECT id, qty_remaining FROM stock_lots WHERE item_id=%s AND qty_remaining > 0 "
                "ORDER BY expiry_date NULLS LAST, id FOR UPDATE",
                [item_id],
            ):
                if remaining <= 0:
                    break
                take = min(remaining, D(lot["qty_remaining"]))
                c.exec("UPDATE stock_lots SET qty_remaining = qty_remaining - %s WHERE id=%s", [take, lot["id"]])
                lot_id = lot_id or lot["id"]
                remaining -= take

    value = q4(qty * uc)
    mv = c.one(
        """INSERT INTO stock_movements(item_id,at,type,qty,unit_cost,value,qty_after,avg_cost_after,reason,
               waste_reason,lot_id,ref_type,ref_id,reversal_of,user_id)
           VALUES (%s,COALESCE(%s::timestamptz, now()),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        [item_id, at, type, qty, uc, value, qa, new_avg, reason, waste_reason, lot_id, ref_type, ref_id,
         reversal_of, uid],
    )
    upd = "UPDATE items SET qty_on_hand=%s, avg_cost=%s, updated_at=now()"
    params: list = [qa, new_avg]
    if type in ("acquisto", "giacenza_iniziale") and qty > 0:
        upd += ", last_purchase_price=%s, last_purchase_date=%s"
        params += [uc, (mv["at"]).date()]
    c.exec(upd + " WHERE id=%s", params + [item_id])
    return mv


def reverse(c: db.Cursor, uid: int | None, movement_id: int, reason: str) -> dict:
    m = c.one("SELECT * FROM stock_movements WHERE id=%s", [movement_id])
    if not m:
        raise bad("Movimento inesistente")
    if m["type"] == "storno":
        raise bad("Uno storno non può essere stornato")
    if c.val("SELECT 1 FROM stock_movements WHERE reversal_of=%s", [movement_id]):
        raise ApiError(409, "Movimento già stornato")
    return move(
        c, uid, m["item_id"], -D(m["qty"]), "storno", unit_cost=m["unit_cost"], reason=reason, at=m["at"],
        ref_type=m["ref_type"], ref_id=m["ref_id"], reversal_of=movement_id, allow_negative=True,
    )


def reverse_ref(c: db.Cursor, uid: int | None, ref_type: str, ref_id: int, reason: str):
    """Storna tutti i movimenti collegati a un documento (es. vendita annullata)."""
    for m in c.all(
        "SELECT id FROM stock_movements WHERE ref_type=%s AND ref_id=%s AND type<>'storno' "
        "AND NOT EXISTS (SELECT 1 FROM stock_movements r WHERE r.reversal_of = stock_movements.id) ORDER BY id DESC",
        [ref_type, ref_id],
    ):
        reverse(c, uid, m["id"], reason)


def stock_value_at(c: db.Cursor, at_end: dt.date | None = None) -> Decimal:
    """Valore delle scorte alla fine del giorno indicato.
    - oggi (o None): giacenza attuale × costo medio di ogni articolo;
    - date passate: somma dei valori dei movimenti fino a quella data (coerente anche con registrazioni retrodatate)."""
    from ..common import today
    if at_end is None or at_end >= today():
        return D(c.val("SELECT COALESCE(sum(GREATEST(qty_on_hand,0) * avg_cost),0) FROM items"))
    return D(c.val(
        "SELECT COALESCE(sum(value),0) FROM stock_movements WHERE (at AT TIME ZONE 'Europe/Rome')::date <= %s",
        [at_end],
    ))


def materials_consumed(c: db.Cursor, d1: dt.date, d2: dt.date) -> Decimal:
    """Costo delle materie prime consumate nel periodo (valore dei movimenti di consumo, storni compresi)."""
    types = list(CONSUMPTION_TYPES)
    return -D(c.val(
        f"""SELECT COALESCE(sum(m.value),0) FROM {MOVES_FROM}
            WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
              AND {EFFECTIVE_TYPE_SQL} = ANY(%s::text[])""",
        [d1, d2, types],
    ))
