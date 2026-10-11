"""Dashboard, conto economico, confronti, analisi, approfondimenti, chiusura mesi, export report."""
import datetime as dt
import json
from decimal import Decimal

from starlette.responses import Response

from .. import db
from ..common import ZERO, D, add_months, get_settings, month_end, month_start, q2, today
from ..http import ApiError, Ctx, api, audit, bad, not_found
from ..services import exporting, reports as R
from ..services import stock


def _range(ctx: Ctx, default="month"):
    t = today()
    d1 = ctx.qdate("from")
    d2 = ctx.qdate("to")
    if not d1 or not d2:
        d1, d2 = (month_start(t), t) if default == "month" else (t, t)
    if d2 < d1:
        raise bad("La data finale precede quella iniziale")
    if (d2 - d1).days > 3700:
        raise bad("Intervallo troppo ampio (massimo 10 anni)")
    return d1, d2


def _prev_same_length(d1, d2):
    n = (d2 - d1).days
    if d1.day == 1 and d2 == month_end(d2):  # mesi interi → mesi precedenti
        months = (d2.year - d1.year) * 12 + d2.month - d1.month + 1
        p1 = add_months(d1, -months)
        return p1, month_end(add_months(p1, months - 1))
    p2 = d1 - dt.timedelta(days=1)
    return p2 - dt.timedelta(days=n), p2


def _last_year(d1, d2):
    def sh(d):
        try:
            return d.replace(year=d.year - 1)
        except ValueError:
            return d.replace(year=d.year - 1, day=28)
    return sh(d1), sh(d2)


def _delta(cur, prev):
    cur, prev = D(cur), D(prev)
    return {"value": q2(prev), "diff": q2(cur - prev), "pct": q2((cur - prev) / abs(prev) * 100) if prev else None}


@api("GET", "/dashboard", "dashboard.view")
def dashboard(ctx: Ctx):
    d1, d2 = _range(ctx)
    t = today()
    fin = ctx.can("dashboard.finance")
    out: dict = {"from": d1, "to": d2, "finance": fin}
    with db.read() as c:
        s = get_settings(c)
        due_days = int(s.get("due_warning_days", 7))
        if ctx.can("inventory.view"):
            out["low_stock"] = c.all("SELECT id, name, unit_code, qty_on_hand, min_qty FROM items WHERE is_active AND min_qty>0 "
                                     "AND qty_on_hand <= min_qty ORDER BY qty_on_hand/NULLIF(min_qty,0) LIMIT 20")
            out["expiring"] = c.all(
                """SELECT l.id, l.lot_code, l.expiry_date, l.qty_remaining, i.name, i.unit_code FROM stock_lots l
                   JOIN items i ON i.id=l.item_id WHERE l.qty_remaining>0 AND l.expiry_date <= current_date + %s::int
                   ORDER BY l.expiry_date LIMIT 20""", [int(s.get("expiry_warning_days", 3))])
        if ctx.can("sales.view"):
            out["today_ops"] = c.one("SELECT count(*) FILTER (WHERE kind='vendita') AS n_sales FROM sales "
                                     "WHERE business_date=%s AND status='valida'", [t])
            out["day_closed"] = bool(c.val("SELECT 1 FROM day_closures WHERE business_date=%s", [t]))
        if not fin:
            return out

        def gross(a, b):
            return D(c.val("SELECT COALESCE(sum(gross_total),0) FROM sales WHERE status='valida' AND business_date BETWEEN %s AND %s",
                           [a, b]))

        def received(a, b):
            return D(c.val("""SELECT COALESCE((SELECT sum(amount) FROM sale_payments WHERE status='incassato' AND settlement_id IS NULL
                                AND received_at BETWEEN %s AND %s),0) + COALESCE((SELECT sum(amount) FROM settlements
                                WHERE voided_at IS NULL AND received_at BETWEEN %s AND %s),0)""", [a, b, a, b]))

        ms, pms = month_start(t), add_months(month_start(t), -1)
        out["kpi_fixed"] = {
            "today_gross": q2(gross(t, t)), "today_received": q2(received(t, t)),
            "month_gross": q2(gross(ms, t)), "month_received": q2(received(ms, t)),
            "prev_month_gross": q2(gross(pms, month_end(pms))),
            "prev_month_same_days_gross": q2(gross(pms, min(month_end(pms), pms + (t - ms)))),
        }
        pl = R.profit_and_loss(c, d1, d2)
        p1, p2 = _prev_same_length(d1, d2)
        ly1, ly2 = _last_year(d1, d2)
        plp = R.profit_and_loss(c, p1, p2)
        ply = R.profit_and_loss(c, ly1, ly2)
        tt = pl["totals"]
        out["pl"] = tt
        out["vat"] = pl["vat"]
        out["prorated"] = pl["prorated"]
        out["compare"] = {
            "previous": {"from": p1, "to": p2, **{k: _delta(tt[k], plp["totals"][k]) for k in
                                                  ("gross_sales", "revenue", "materials", "gross_margin", "operating", "result", "expenses_total")}},
            "last_year": {"from": ly1, "to": ly2, **{k: _delta(tt[k], ply["totals"][k]) for k in
                                                     ("gross_sales", "revenue", "materials", "gross_margin", "operating", "result", "expenses_total")}},
        }
        liq = R.liquidity(c, d1, d2)
        out["liquidity"] = liq
        out["expenses_paid"] = liq["outflows_expenses"]
        out["expenses_month"] = q2(c.val(
            "SELECT COALESCE(sum(total_amount),0) FROM expenses WHERE voided_at IS NULL AND doc_date BETWEEN %s AND %s", [d1, d2]))
        out["due"] = c.all(
            """SELECT e.id, e.description, e.due_date, e.total_amount - e.paid_amount AS residual, s.legal_name AS supplier_name,
                      e.due_date < current_date AS overdue
               FROM expenses e LEFT JOIN suppliers s ON s.id=e.supplier_id
               WHERE e.voided_at IS NULL AND e.status<>'pagata' AND e.due_date IS NOT NULL AND e.due_date <= current_date + %s::int
               ORDER BY e.due_date LIMIT 30""", [due_days])
        out["due_total"] = q2(sum(D(x["residual"]) for x in out["due"]))
        days = (d2 - d1).days
        if days <= 92:
            out["daily"] = R.daily_series(c, d1, d2)
        out["monthly"] = R.monthly_series(c, d2, 12)
        out["top_products"] = R.product_analysis(c, d1, d2)[:8]
        return out


@api("GET", "/reports/pl", "reports.view")
def pl(ctx: Ctx):
    d1, d2 = _range(ctx)
    with db.read() as c:
        p = R.profit_and_loss(c, d1, d2)
        p["liquidity"] = R.liquidity(c, d1, d2)
        p["checks"] = R.consistency_checks(c, d1, d2)
        p["expenses_by_category"] = R.expenses_by_category(c, d1, d2)
        p["closed"] = c.one("SELECT p.*, u.full_name AS closed_by_name FROM period_closures p LEFT JOIN users u ON u.id=p.closed_by "
                            "WHERE period=%s", [month_start(d1)]) if R.whole_months(d1, d2) and d1.month == d2.month and d1.year == d2.year else None
        return p


@api("GET", "/reports/compare", "reports.view")
def compare(ctx: Ctx):
    kind = ctx.q("kind", "mese")
    if kind not in ("mese", "trimestre", "anno"):
        raise bad("Tipo di confronto non valido")
    a = R.period_range(kind, ctx.q("a_year", today().year, int), ctx.q("a_n", 1, int))
    b = R.period_range(kind, ctx.q("b_year", today().year, int), ctx.q("b_n", 1, int))
    with db.read() as c:
        pa, pb = R.profit_and_loss(c, *a), R.profit_and_loss(c, *b)
        la, lb = R.liquidity(c, *a), R.liquidity(c, *b)
    rows = []
    for x, y in zip(pa["lines"], pb["lines"]):
        rows.append({"key": x["key"], "label": x["label"], "kind": x["kind"], "level": x["level"],
                     "a": x["amount"], "b": y["amount"], "diff": q2(D(x["amount"]) - D(y["amount"])),
                     "pct": q2((D(x["amount"]) - D(y["amount"])) / abs(D(y["amount"])) * 100) if D(y["amount"]) else None})
    liq_keys = [("inflows", "Entrate monetarie"), ("outflows", "Uscite monetarie"), ("net_cash_flow", "Flusso di cassa netto"),
                ("receivables", "Crediti da incassare (a fine periodo)"), ("payables", "Debiti da pagare (a fine periodo)"),
                ("cash_total", "Saldo cassa e conti (a fine periodo)"), ("stock_value", "Valore scorte (a fine periodo)")]
    liq = [{"label": l, "a": la[k], "b": lb[k], "diff": q2(D(la[k]) - D(lb[k]))} for k, l in liq_keys]
    return {"a": {"from": a[0], "to": a[1]}, "b": {"from": b[0], "to": b[1]}, "rows": rows, "liquidity": liq}


@api("GET", "/reports/analysis", "reports.view")
def analysis(ctx: Ctx):
    d1, d2 = _range(ctx)
    with db.read() as c:
        cards = []
        for p in c.all("SELECT * FROM products WHERE is_active ORDER BY name"):
            from ..services import recipes
            card = recipes.product_card(c, p)
            cards.append({"id": p["id"], "name": p["name"], "sale_price": p["sale_price"], "unit_cost": card["unit_cost"],
                          "food_cost_pct": card["food_cost_pct"], "gross_margin": card["gross_margin"],
                          "target_margin_pct": card["target_margin_pct"], "suggested_price": card["suggested_price"],
                          "has_recipe": card["has_recipe"], "missing_costs": card["missing_costs"],
                          "over_target": card["gross_margin_pct"] is not None and card["gross_margin_pct"] < card["target_margin_pct"]})
        return {
            "from": d1, "to": d2,
            "products": R.product_analysis(c, d1, d2),
            "product_costs": sorted(cards, key=lambda x: -(x["food_cost_pct"] or 0)),
            "ingredients": R.ingredient_consumption(c, d1, d2),
            "expense_categories": R.expenses_by_category(c, d1, d2),
            "channels": R.channel_analysis(c, d1, d2),
            "weekdays": R.weekday_analysis(c, d1, d2),
            "hours": R.hourly_analysis(c, d1, d2),
            "top_days": R.top_days(c, d1, d2),
            "break_even": R.break_even(c, d2 + dt.timedelta(days=1) if d2 == month_end(d2) else d2, ctx.q("be_months", 3, int)),
        }


@api("GET", "/reports/break-even", "reports.view")
def break_even(ctx: Ctx):
    with db.read() as c:
        return R.break_even(c, ctx.qdate("ref", today()), ctx.q("months", 3, int))


# ---------------------------------------------------------------- approfondimento dei numeri

def _cols(*spec):
    return [{"key": k, "label": l, "type": t} for k, l, t in spec]


@api("GET", "/drill", ["reports.view", "dashboard.finance"])
def drill(ctx: Ctx):
    metric = ctx.q("metric") or ""
    d1, d2 = _range(ctx)
    with db.read() as c:
        s = get_settings(c)
        forf = s.get("vat_regime") == "forfettario"
        if metric in ("sales", "discounts", "refunds", "gross_sales"):
            extra = {"discounts": " AND s.discount_total > 0 AND s.kind='vendita'", "refunds": " AND s.kind='rimborso'"}.get(metric, "")
            rows = c.all(f"""SELECT s.id, s.number, s.sold_at, s.kind, s.mode, ch.name AS channel, s.gross_before_discount,
                                    s.discount_total, s.gross_total, s.net_total, s.vat_total, s.commission_gross
                             FROM sales s JOIN sales_channels ch ON ch.id=s.channel_id
                             WHERE s.status='valida' AND s.business_date BETWEEN %s AND %s{extra} ORDER BY s.sold_at""", [d1, d2])
            key = {"discounts": "discount_total", "refunds": "gross_total", "gross_sales": "gross_total"}.get(metric, "gross_total" if forf else "net_total")
            return {"title": {"sales": "Vendite del periodo", "discounts": "Vendite con sconto", "refunds": "Rimborsi",
                              "gross_sales": "Vendite del periodo"}[metric],
                    "link": "sale", "columns": _cols(("number", "N.", "text"), ("sold_at", "Data e ora", "datetime"),
                                                     ("channel", "Canale", "text"), ("mode", "Modalità", "text"),
                                                     ("gross_before_discount", "Lordo", "money"), ("discount_total", "Sconti", "money"),
                                                     ("gross_total", "Totale", "money"), ("net_total", "Imponibile", "money"),
                                                     ("commission_gross", "Commissione", "money")),
                    "rows": rows, "total": q2(sum(D(r[key]) for r in rows)), "total_key": key}
        if metric == "received":
            rows = c.all("""SELECT sp.received_at AS day, 'Vendita n. ' || s.number AS description, pm.name AS method, sp.amount
                            FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id JOIN payment_methods pm ON pm.id=sp.method_id
                            WHERE sp.status='incassato' AND sp.settlement_id IS NULL AND sp.received_at BETWEEN %s AND %s
                            UNION ALL
                            SELECT st.received_at, 'Accredito ' || COALESCE(ch.name,'') || COALESCE(' – ' || st.notes,''), a.name, st.amount
                            FROM settlements st LEFT JOIN sales_channels ch ON ch.id=st.channel_id JOIN accounts a ON a.id=st.account_id
                            WHERE st.voided_at IS NULL AND st.received_at BETWEEN %s AND %s ORDER BY 1""", [d1, d2, d1, d2])
            return {"title": "Incassi effettivi", "columns": _cols(("day", "Data", "date"), ("description", "Descrizione", "text"),
                                                                   ("method", "Metodo / conto", "text"), ("amount", "Importo", "money")),
                    "rows": rows, "total": q2(sum(D(r["amount"]) for r in rows)), "total_key": "amount"}
        if metric == "materials":
            if s.get("materials_cost_method") == "acquisti":
                metric = "group:materie_prime"
            else:
                rows = c.all(f"""SELECT m.at, i.name AS item, m.type, {stock.EFFECTIVE_TYPE_SQL} AS effective_type, m.qty, i.unit_code,
                                        m.unit_cost, -m.value AS cost, m.reason
                                 FROM {stock.MOVES_FROM} JOIN items i ON i.id=m.item_id
                                 WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
                                   AND {stock.EFFECTIVE_TYPE_SQL} = ANY(%s::text[]) ORDER BY m.at""",
                             [d1, d2, list(stock.CONSUMPTION_TYPES)])
                for r in rows:
                    r["type"] = stock.TYPE_LABELS.get(r["type"], r["type"])
                return {"title": "Costo materie prime consumate", "link": "item",
                        "columns": _cols(("at", "Data e ora", "datetime"), ("item", "Articolo", "text"), ("type", "Tipo", "text"),
                                         ("qty", "Quantità", "number"), ("unit_code", "U.M.", "text"),
                                         ("unit_cost", "Costo unit.", "money4"), ("cost", "Costo", "money"), ("reason", "Causale", "text")),
                        "rows": rows, "total": q2(sum(D(r["cost"]) for r in rows)), "total_key": "cost"}
        if metric.startswith("group:") or metric in ("variable", "expenses_total"):
            prorate = not R.whole_months(d1, d2)
            allocs = R.expense_allocations(c, d1, d2, s, prorate)
            rows = []
            if metric == "variable" and s.get("platform_commissions_from", "vendite") == "vendite":
                for r in c.all("""SELECT s.business_date AS date, 'Commissione vendita n. ' || s.number || ' (' || ch.name || ')' AS description,
                                         'Commissioni piattaforme' AS category, s.commission_net AS amount, s.commission_gross AS amount_total
                                  FROM sales s JOIN sales_channels ch ON ch.id=s.channel_id
                                  WHERE s.status='valida' AND s.commission_gross <> 0 AND s.business_date BETWEEN %s AND %s""", [d1, d2]):
                    if forf:
                        r["amount"] = r["amount_total"]
                    rows.append(r)
            groups = {"variable": {"costi_variabili"}, "expenses_total": {"costi_variabili", "costi_fissi", "personale",
                      "altri_operativi", "investimenti", "oneri_finanziari", "imposte"}}.get(metric, {metric[6:]})
            if "altri_operativi" in groups:
                groups.add("investimenti")
            for a in allocs:
                if a["pl_group"] not in groups:
                    continue
                if a["is_inventory"] and s.get("materials_cost_method") == "consumi":
                    continue
                if a["is_platform_commission"] and s.get("platform_commissions_from", "vendite") == "vendite":
                    continue
                rows.append({"id": a["id"], "date": a["competence_date"], "description": a["description"], "category": a["category"],
                             "amount": q2(a["amount"]), "_raw": a["amount"]})
            if metric != "variable":
                for e in c.all("SELECT entry_date AS date, description, pl_group AS category, amount FROM economic_entries "
                               "WHERE voided_at IS NULL AND entry_date BETWEEN %s AND %s AND pl_group = ANY(%s::text[])",
                               [d1, d2, list(groups)]):
                    rows.append(e)
            rows.sort(key=lambda r: r["date"])
            return {"title": R.GROUP_LABELS.get(metric[6:], "Costi") if metric.startswith("group:") else
                    ("Commissioni e costi variabili" if metric == "variable" else "Spese del periodo"),
                    "link": "expense", "note": "Importi netti IVA (se detraibile); costi fissi ripartiti per giorni" if prorate else
                    "Importi netti IVA se detraibile",
                    "columns": _cols(("date", "Competenza", "date"), ("description", "Descrizione", "text"),
                                     ("category", "Categoria", "text"), ("amount", "Importo a conto economico", "money")),
                    "rows": rows, "total": q2(sum(D(r.pop("_raw", r["amount"])) for r in rows)), "total_key": "amount"}
        if metric == "entries":
            rows = c.all("SELECT entry_date AS date, description, pl_group AS category, amount FROM economic_entries "
                         "WHERE voided_at IS NULL AND entry_date BETWEEN %s AND %s ORDER BY 1", [d1, d2])
            return {"title": "Altre componenti economiche", "columns": _cols(("date", "Data", "date"), ("description", "Descrizione", "text"),
                    ("category", "Gruppo", "text"), ("amount", "Importo", "money")), "rows": rows,
                    "total": q2(sum(D(r["amount"]) for r in rows)), "total_key": "amount"}
        if metric == "stock_value":
            rows = c.all("SELECT id, name, sku, unit_code, qty_on_hand, avg_cost, GREATEST(qty_on_hand,0)*avg_cost AS value "
                         "FROM items WHERE qty_on_hand <> 0 ORDER BY value DESC")
            return {"title": "Valore delle scorte (oggi)", "link": "item",
                    "columns": _cols(("name", "Articolo", "text"), ("sku", "Codice", "text"), ("qty_on_hand", "Giacenza", "number"),
                                     ("unit_code", "U.M.", "text"), ("avg_cost", "Costo medio", "money4"), ("value", "Valore", "money")),
                    "rows": rows, "total": q2(sum(D(r["value"]) for r in rows)), "total_key": "value"}
        if metric == "receivables":
            rows = c.all("""SELECT s.id, s.number, s.business_date AS date, ch.name AS channel, pm.name AS method, sp.amount
                            FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id JOIN sales_channels ch ON ch.id=s.channel_id
                            JOIN payment_methods pm ON pm.id=sp.method_id
                            WHERE s.status='valida' AND s.business_date <= %s
                              AND (sp.status='in_attesa' OR (sp.status='incassato' AND sp.received_at > %s)) ORDER BY 3""", [d2, d2])
            return {"title": "Crediti da incassare", "link": "sale",
                    "columns": _cols(("number", "Vendita", "text"), ("date", "Data", "date"), ("channel", "Canale", "text"),
                                     ("method", "Metodo", "text"), ("amount", "Importo", "money")),
                    "rows": rows, "total": q2(sum(D(r["amount"]) for r in rows)), "total_key": "amount"}
        if metric in ("payables", "due"):
            rows = c.all("""SELECT e.id, e.doc_date AS date, e.description, s.legal_name AS supplier, e.due_date, e.total_amount,
                                   e.total_amount - COALESCE((SELECT sum(p.amount) FROM expense_payments p WHERE p.expense_id=e.id
                                       AND p.voided_at IS NULL AND p.paid_at <= %s),0) AS residual
                            FROM expenses e LEFT JOIN suppliers s ON s.id=e.supplier_id
                            WHERE e.voided_at IS NULL AND e.doc_date <= %s ORDER BY e.due_date NULLS LAST""", [d2, d2])
            rows = [r for r in rows if D(r["residual"]) != 0]
            return {"title": "Debiti da pagare", "link": "expense",
                    "columns": _cols(("date", "Data doc.", "date"), ("description", "Descrizione", "text"), ("supplier", "Fornitore", "text"),
                                     ("due_date", "Scadenza", "date"), ("total_amount", "Totale", "money"), ("residual", "Residuo", "money")),
                    "rows": rows, "total": q2(sum(D(r["residual"]) for r in rows)), "total_key": "residual"}
        if metric == "paid":
            rows = c.all("""SELECT p.paid_at AS date, e.id, e.description, a.name AS account, p.amount FROM expense_payments p
                            JOIN expenses e ON e.id=p.expense_id JOIN accounts a ON a.id=p.account_id
                            WHERE p.voided_at IS NULL AND p.paid_at BETWEEN %s AND %s ORDER BY 1""", [d1, d2])
            return {"title": "Uscite per spese pagate", "link": "expense",
                    "columns": _cols(("date", "Data", "date"), ("description", "Spesa", "text"), ("account", "Conto", "text"),
                                     ("amount", "Importo", "money")),
                    "rows": rows, "total": q2(sum(D(r["amount"]) for r in rows)), "total_key": "amount"}
        if metric == "expenses_docs":
            rows = c.all("""SELECT e.id, e.doc_date AS date, e.description, ec.name AS category, e.total_amount FROM expenses e
                            JOIN expense_categories ec ON ec.id=e.category_id
                            WHERE e.voided_at IS NULL AND e.doc_date BETWEEN %s AND %s ORDER BY 2""", [d1, d2])
            return {"title": "Spese registrate (documenti del periodo)", "link": "expense",
                    "columns": _cols(("date", "Data doc.", "date"), ("description", "Descrizione", "text"),
                                     ("category", "Categoria", "text"), ("total_amount", "Totale IVA incl.", "money")),
                    "rows": rows, "total": q2(sum(D(r["total_amount"]) for r in rows)), "total_key": "total_amount"}
    raise bad("Dato non approfondibile")


# ---------------------------------------------------------------- chiusura mesi

@api("GET", "/periods", "reports.view")
def list_periods(ctx: Ctx):
    with db.read() as c:
        return c.all("SELECT p.period, p.closed_at, u.full_name AS closed_by_name FROM period_closures p "
                     "LEFT JOIN users u ON u.id=p.closed_by ORDER BY period DESC")


def _period(ctx):
    try:
        y, m = ctx.params["ym"].split("-")
        return dt.date(int(y), int(m), 1)
    except Exception:
        raise bad("Periodo non valido (formato AAAA-MM)")


@api("POST", "/periods/{ym}/close", "periods.close")
def close_period(ctx: Ctx):
    p = _period(ctx)
    if month_end(p) >= today():
        raise bad("Puoi chiudere solo mesi già terminati")
    with db.tx() as c:
        if c.val("SELECT 1 FROM period_closures WHERE period=%s", [p]):
            raise bad("Mese già chiuso")
        snap = R.profit_and_loss(c, p, month_end(p))
        snap_json = json.loads(json.dumps(snap, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)))
        c.exec("INSERT INTO period_closures(period,closed_by,snapshot) VALUES (%s,%s,%s::jsonb)",
               [p, ctx.uid, json.dumps(snap_json)])
        audit(c, ctx, "create", "period", p.isoformat(), f"Mese {p.strftime('%m/%Y')} chiuso – risultato {snap['totals']['result']} €")
    return {"ok": True}


@api("DELETE", "/periods/{ym}/close", "periods.close")
def reopen_period(ctx: Ctx):
    p = _period(ctx)
    with db.tx() as c:
        before = c.one("SELECT period, closed_at, closed_by FROM period_closures WHERE period=%s", [p])
        if not before:
            raise not_found("Chiusura")
        c.exec("DELETE FROM period_closures WHERE period=%s", [p])
        audit(c, ctx, "delete", "period", p.isoformat(), f"Mese {p.strftime('%m/%Y')} riaperto", before)
    return {"ok": True}


# ---------------------------------------------------------------- download report

@api("GET", "/reports/pl.xlsx", "reports.export")
def pl_xlsx(ctx: Ctx):
    d1, d2 = _range(ctx)
    with db.read() as c:
        data = exporting.report_data(c, d1, d2)
    content = exporting.pl_to_xlsx(data)
    return Response(content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="report-{d1}_{d2}.xlsx"'})


@api("GET", "/reports/pl.pdf", "reports.export")
def pl_pdf(ctx: Ctx):
    d1, d2 = _range(ctx)
    with db.read() as c:
        data = exporting.report_data(c, d1, d2)
    content = exporting.pl_to_pdf(data)
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="report-{d1}_{d2}.pdf"'})
