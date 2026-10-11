"""Omaggi e assaggi: prodotti regalati ai passanti. Prezzo 0 €, ma il magazzino scende e il costo
finisce tra le materie prime (come uno spreco con motivo «omaggio»)."""
from collections import defaultdict
from decimal import Decimal

from pydantic import BaseModel, Field

from .. import db
from ..common import ZERO, D, now, parse_ts, q4, q6
from ..http import Ctx, api, audit, bad
from ..services import recipes, stock


class GiveLine(BaseModel):
    product_id: int
    qty: Decimal = Field(gt=0)


class GiveIn(BaseModel):
    lines: list[GiveLine] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=300)
    at: str | None = None


@api("POST", "/giveaways", "sales.create")
def create_giveaway(ctx: Ctx):
    data = ctx.parse(GiveIn)
    at = parse_ts(data.at) if (data.at and ctx.can("sales.void")) else now()
    with db.tx() as c:
        g = c.one("INSERT INTO giveaways(given_at,notes,user_id) VALUES (%s,%s,%s) RETURNING *", [at, data.notes, ctx.uid])
        consume: dict[int, Decimal] = defaultdict(lambda: ZERO)
        names = []
        for ln in data.lines:
            p = c.one("SELECT * FROM products WHERE id=%s", [ln.product_id])
            if not p:
                raise bad("Prodotto non valido")
            v = recipes.version_at(c, product_id=p["id"], at=at)
            uc = recipes.cost_of_version(c, v)["unit_cost"] if v else ZERO
            c.exec("INSERT INTO giveaway_lines(giveaway_id,product_id,qty,unit_cost) VALUES (%s,%s,%s,%s)",
                   [g["id"], p["id"], q4(ln.qty), q6(uc)])
            names.append(f"{ln.qty.normalize():f} {p['name']}")
            if v and p["unload_stock"]:
                for item_id, q in recipes.explode(c, v["id"], ln.qty).items():
                    consume[item_id] += q
        total = ZERO
        for item_id, q in sorted(consume.items()):
            if q > 0:
                mv = stock.move(c, ctx.uid, item_id, -q, "spreco", at=at, waste_reason="omaggio", ref_type="giveaway",
                                ref_id=g["id"], reason=f"Omaggio / assaggio n. {g['id']}")
                total += -D(mv["value"])
        c.exec("UPDATE giveaways SET cost_total=%s WHERE id=%s", [q4(total), g["id"]])
        audit(c, ctx, "create", "giveaway", g["id"], "Omaggio / assaggio: " + ", ".join(names))
    return {"id": g["id"], "summary": ", ".join(names)}


@api("GET", "/giveaways", ["sales.view", "inventory.view"])
def list_giveaways(ctx: Ctx):
    d2 = ctx.qdate("to")
    d1 = ctx.qdate("from")
    with db.read() as c:
        rows = c.all(
            """SELECT g.*, u.full_name AS user_name,
                      (SELECT string_agg(trim(to_char(l.qty,'FM999990.##')) || ' ' || p.name, ', ' ORDER BY l.id)
                         FROM giveaway_lines l JOIN products p ON p.id=l.product_id WHERE l.giveaway_id=g.id) AS summary,
                      (SELECT sum(l.qty) FROM giveaway_lines l WHERE l.giveaway_id=g.id) AS pieces
               FROM giveaways g LEFT JOIN users u ON u.id=g.user_id
               WHERE (%s::date IS NULL OR (g.given_at AT TIME ZONE 'Europe/Rome')::date >= %s::date)
                 AND (%s::date IS NULL OR (g.given_at AT TIME ZONE 'Europe/Rome')::date <= %s::date)
               ORDER BY g.given_at DESC LIMIT 300""", [d1, d1, d2, d2])
    if not ctx.can("inventory.costs"):
        for r in rows:
            r.pop("cost_total", None)
    return rows


@api("POST", "/giveaways/{id}/void", "sales.void")
def void_giveaway(ctx: Ctx):
    reason = (ctx.body or {}).get("reason") or "Annullato"
    with db.tx() as c:
        g = c.one("SELECT * FROM giveaways WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not g or g["voided_at"]:
            raise bad("Omaggio non valido o già annullato")
        stock.reverse_ref(c, ctx.uid, "giveaway", g["id"], f"Annullamento omaggio: {reason}")
        c.exec("UPDATE giveaways SET voided_at=now(), voided_by=%s, void_reason=%s WHERE id=%s", [ctx.uid, reason, g["id"]])
        audit(c, ctx, "void", "giveaway", g["id"], f"Omaggio annullato: {reason}")
    return {"ok": True}
