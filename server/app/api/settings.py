"""Impostazioni e tabelle di base (unità, categorie, canali, metodi di pagamento, conti)."""
import json

from .. import db
from ..common import D
from ..http import Ctx, api, audit, bad, not_found

EDITABLE_SETTINGS = {
    "company": dict, "vat_regime": str, "default_sale_vat_rate": (int, float), "default_target_margin_pct": (int, float),
    "allow_negative_stock": bool, "materials_cost_method": str, "expiry_warning_days": int, "due_warning_days": int,
    "lock_closed_days": bool, "platform_commissions_from": str, "refund_reverses_commission": bool,
}
CHOICES = {
    "vat_regime": {"ordinario", "forfettario"},
    "materials_cost_method": {"consumi", "acquisti"},
    "platform_commissions_from": {"vendite", "spese"},
}


@api("GET", "/settings")
def get_settings(ctx: Ctx):
    with db.read() as c:
        return {r["key"]: r["value"] for r in c.all("SELECT key, value FROM settings")}


@api("PUT", "/settings", "settings.manage")
def put_settings(ctx: Ctx):
    data = ctx.body or {}
    with db.tx() as c:
        for k, v in data.items():
            if k not in EDITABLE_SETTINGS:
                continue
            if not isinstance(v, EDITABLE_SETTINGS[k]) or (k in CHOICES and v not in CHOICES[k]):
                raise bad(f"Valore non valido per {k}")
            before = c.val("SELECT value FROM settings WHERE key=%s", [k])
            c.exec("INSERT INTO settings(key,value) VALUES (%s,%s::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
                   [k, json.dumps(v)])
            if before != v:
                audit(c, ctx, "update", "settings", k, f"Impostazione «{k}» modificata", {"value": before}, {"value": v})
    return {"ok": True}


# ---------------------------------------------------------------- tabelle di base generiche
LOOKUPS = {
    "units": {"table": "units", "pk": "code", "fields": {"code": str, "name": str, "dimension": str, "factor": "num"},
              "order": "dimension, factor DESC"},
    "item-categories": {"table": "item_categories", "pk": "id", "fields": {"name": str}, "order": "name"},
    "product-categories": {"table": "product_categories", "pk": "id", "fields": {"name": str, "sort_order": int},
                           "order": "sort_order, name"},
    "expense-categories": {"table": "expense_categories", "pk": "id",
                           "fields": {"name": str, "pl_group": str, "is_inventory": bool, "is_platform_commission": bool,
                                      "amortization_months": "int?", "is_active": bool, "sort_order": int},
                           "order": "sort_order, name"},
    "channels": {"table": "sales_channels", "pk": "id",
                 "fields": {"name": str, "commission_pct": "num", "commission_fixed": "num", "commission_vat_rate": "num",
                            "default_payment_method_id": "int?", "is_active": bool, "sort_order": int},
                 "order": "sort_order, name"},
    "payment-methods": {"table": "payment_methods", "pk": "id",
                        "fields": {"name": str, "kind": str, "account_id": "int?", "received_immediately": bool,
                                   "is_active": bool, "sort_order": int},
                        "order": "sort_order, name"},
    "accounts": {"table": "accounts", "pk": "id",
                 "fields": {"name": str, "kind": str, "opening_balance": "num", "opening_date": "date",
                            "is_active": bool},
                 "order": "id"},
}


def _clean(spec, data: dict, partial=False):
    out = {}
    for f, t in spec["fields"].items():
        if f not in data:
            continue
        v = data[f]
        if t == "num":
            v = D(v)
        elif t == "int?":
            v = int(v) if v not in (None, "") else None
        elif t == "date":
            v = v or None
        elif t is int:
            v = int(v or 0)
        elif t is bool:
            v = bool(v)
        elif t is str:
            v = (str(v).strip() if v is not None else "")
            if not v:
                raise bad(f"Il campo «{f}» è obbligatorio")
        out[f] = v
    return out


def _lookup_spec(ctx):
    spec = LOOKUPS.get(ctx.params["kind"])
    if not spec:
        raise not_found("Tabella")
    return spec


@api("GET", "/lookups/{kind}")
def lookup_list(ctx: Ctx):
    spec = _lookup_spec(ctx)
    with db.read() as c:
        return c.all(f"SELECT * FROM {spec['table']} ORDER BY {spec['order']}")


@api("GET", "/lookups")
def lookup_all(ctx: Ctx):
    with db.read() as c:
        return {k: c.all(f"SELECT * FROM {s['table']} ORDER BY {s['order']}") for k, s in LOOKUPS.items()}


@api("POST", "/lookups/{kind}", ["settings.manage", "inventory.edit", "products.edit"])
def lookup_create(ctx: Ctx):
    spec = _lookup_spec(ctx)
    if ctx.params["kind"] not in ("item-categories", "product-categories", "units") and not ctx.can("settings.manage"):
        ctx.require("settings.manage")
    data = _clean(spec, ctx.body or {})
    if "name" in spec["fields"] and "name" not in data:
        raise bad("Il nome è obbligatorio")
    cols = list(data)
    with db.tx() as c:
        row = c.one(
            f"INSERT INTO {spec['table']}({','.join(cols)}) VALUES ({','.join(['%s'] * len(cols))}) RETURNING *",
            [data[k] for k in cols],
        )
        audit(c, ctx, "create", spec["table"], row[spec["pk"]], f"Creato «{row.get('name')}»", None, row)
    return row


@api("PUT", "/lookups/{kind}/{key}", "settings.manage")
def lookup_update(ctx: Ctx):
    spec = _lookup_spec(ctx)
    data = _clean(spec, ctx.body or {})
    data.pop(spec["pk"], None)
    if not data:
        raise bad("Nessun dato da aggiornare")
    key = ctx.params["key"]
    with db.tx() as c:
        before = c.one(f"SELECT * FROM {spec['table']} WHERE {spec['pk']}::text=%s FOR UPDATE", [key])
        if not before:
            raise not_found()
        sets = ", ".join(f"{k}=%s" for k in data)
        row = c.one(f"UPDATE {spec['table']} SET {sets} WHERE {spec['pk']}::text=%s RETURNING *", list(data.values()) + [key])
        audit(c, ctx, "update", spec["table"], key, f"Modificato «{row.get('name')}»", before, row)
    return row


@api("DELETE", "/lookups/{kind}/{key}", "settings.manage")
def lookup_delete(ctx: Ctx):
    spec = _lookup_spec(ctx)
    key = ctx.params["key"]
    with db.tx() as c:
        before = c.one(f"SELECT * FROM {spec['table']} WHERE {spec['pk']}::text=%s", [key])
        if not before:
            raise not_found()
        c.exec(f"DELETE FROM {spec['table']} WHERE {spec['pk']}::text=%s", [key])
        audit(c, ctx, "delete", spec["table"], key, f"Eliminato «{before.get('name')}»", before)
    return {"ok": True}
