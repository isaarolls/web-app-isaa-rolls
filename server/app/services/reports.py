"""Conto economico gestionale, liquidità, IVA, controlli di coerenza e analisi.

Criteri (configurabili in Impostazioni, da verificare con il commercialista):
- Ricavi: imponibile delle vendite valide (IVA scorporata dal prezzo al pubblico), al netto di sconti e rimborsi.
- Materie prime: 'consumi' = valore a costo medio dei movimenti di consumo/spreco/rettifica del periodo
  (gli acquisti di magazzino NON sono costi finché non si consumano: niente doppi conteggi);
  'acquisti' = spese delle categorie di magazzino registrate nel periodo.
- Spese: imputate per data di competenza; importo netto se l'IVA è detraibile, altrimenti lordo.
  Le categorie con ammortamento sono ripartite in N mesi.
- Per periodi che non coprono mesi interi, costi fissi e personale vengono ripartiti per giorni.
- Il risultato è una STIMA GESTIONALE, non un bilancio fiscale.
"""
from __future__ import annotations

import calendar
import datetime as dt
from collections import defaultdict
from decimal import Decimal

from .. import db
from ..common import ZERO, D, add_months, get_settings, month_end, month_start, q2
from . import stock

FIXED_GROUPS = {"costi_fissi", "personale"}
GROUP_LABELS = {
    "materie_prime": "Materie prime e confezioni",
    "costi_variabili": "Commissioni e altri costi variabili",
    "costi_fissi": "Costi fissi",
    "personale": "Costi del personale",
    "altri_operativi": "Altri costi operativi",
    "investimenti": "Investimenti e attrezzature",
    "oneri_finanziari": "Interessi e oneri finanziari",
    "imposte": "Imposte e tributi registrati",
    "non_economica": "Non economiche (escluse)",
    "altri_ricavi": "Altri ricavi",
    "altre_componenti": "Altre componenti",
}


def _overlap_days(a1: dt.date, a2: dt.date, b1: dt.date, b2: dt.date) -> int:
    s, e = max(a1, b1), min(a2, b2)
    return (e - s).days + 1 if e >= s else 0


def whole_months(d1: dt.date, d2: dt.date) -> bool:
    return d1.day == 1 and d2 == month_end(d2)


def expense_allocations(c: db.Cursor, d1: dt.date, d2: dt.date, settings: dict, prorate: bool):
    """Restituisce le quote economiche delle spese che cadono nel periodo:
    lista di dict {expense_id, category, pl_group, is_inventory, is_platform_commission, amount, ...}"""
    forfettario = settings.get("vat_regime") == "forfettario"
    max_amort = c.val("SELECT COALESCE(max(amortization_months),0) FROM expense_categories") or 0
    lookback = add_months(month_start(d1), -int(max_amort) - 1)
    rows = c.all(
        """SELECT e.id, e.description, e.competence_date, e.net_amount, e.total_amount, e.vat_deductible,
                  e.receipt_id, e.supplier_id, ec.id AS category_id, ec.name AS category, ec.pl_group,
                  ec.is_inventory, ec.is_platform_commission, ec.amortization_months
           FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
           WHERE e.voided_at IS NULL AND e.competence_date BETWEEN %s AND %s""",
        [lookback, month_end(d2)],
    )
    out = []
    for r in rows:
        base = D(r["total_amount"]) if (forfettario or not r["vat_deductible"]) else D(r["net_amount"])
        comp = r["competence_date"]
        n = r["amortization_months"]
        amt = ZERO
        if n:
            share = base / n
            m0 = month_start(comp)
            for k in range(n):
                ms = add_months(m0, k)
                me = month_end(ms)
                od = _overlap_days(ms, me, d1, d2)
                if od:
                    amt += share * od / ((me - ms).days + 1)
        elif r["pl_group"] in FIXED_GROUPS and prorate:
            ms, me = month_start(comp), month_end(comp)
            od = _overlap_days(ms, me, d1, d2)
            if od:
                amt = base * od / ((me - ms).days + 1)
        elif d1 <= comp <= d2:
            amt = base
        if amt:
            r["amount"] = amt
            out.append(r)
    return out


def profit_and_loss(c: db.Cursor, d1: dt.date, d2: dt.date) -> dict:
    s = get_settings(c)
    forfettario = s.get("vat_regime") == "forfettario"
    prorate = not whole_months(d1, d2)
    mat_method = s.get("materials_cost_method", "consumi")
    comm_from = s.get("platform_commissions_from", "vendite")

    sales = c.one(
        """SELECT
             COALESCE(sum(gross_before_discount) FILTER (WHERE kind='vendita'),0) AS gross_sales,
             COALESCE(sum(discount_total) FILTER (WHERE kind='vendita'),0) AS discounts,
             COALESCE(-sum(gross_total) FILTER (WHERE kind='rimborso'),0) AS refunds,
             COALESCE(sum(gross_total),0) AS gross_total,
             COALESCE(sum(net_total),0) AS net_total,
             COALESCE(sum(vat_total),0) AS vat_total,
             COALESCE(sum(commission_gross),0) AS comm_gross,
             COALESCE(sum(commission_net),0) AS comm_net,
             COALESCE(sum(commission_vat),0) AS comm_vat,
             COALESCE(sum(cost_total) FILTER (WHERE kind='vendita'),0) AS theoretical_cost,
             count(*) FILTER (WHERE kind='vendita') AS n_sales,
             COALESCE(sum(gross_total) FILTER (WHERE mode='riepilogo' AND kind='vendita'),0) AS summary_mode_gross
           FROM sales WHERE status='valida' AND business_date BETWEEN %s AND %s""",
        [d1, d2],
    )
    revenue = D(sales["gross_total"]) if forfettario else D(sales["net_total"])

    allocs = expense_allocations(c, d1, d2, s, prorate)
    groups: dict[str, Decimal] = defaultdict(lambda: ZERO)
    excluded: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for a in allocs:
        g = a["pl_group"]
        if a["is_inventory"] and mat_method == "consumi":
            excluded["acquisti_magazzino"] += a["amount"]
            continue
        if a["is_platform_commission"] and comm_from == "vendite":
            excluded["commissioni_fatturate"] += a["amount"]
            continue
        if g == "non_economica":
            excluded["non_economiche"] += a["amount"]
            continue
        if g == "investimenti":
            g = "altri_operativi"
        groups[g] += a["amount"]

    for e in c.all(
        "SELECT pl_group, COALESCE(sum(amount),0) AS amount FROM economic_entries "
        "WHERE voided_at IS NULL AND entry_date BETWEEN %s AND %s GROUP BY pl_group",
        [d1, d2],
    ):
        groups[e["pl_group"]] += D(e["amount"])

    # in modalità 'consumi' restano qui solo eventuali categorie "materie prime" NON di magazzino
    materials = groups.pop("materie_prime", ZERO)
    if mat_method == "consumi":
        materials += stock.materials_consumed(c, d1, d2)

    commissions = (D(sales["comm_gross"]) if forfettario else D(sales["comm_net"])) if comm_from == "vendite" else ZERO
    variable = commissions + groups["costi_variabili"]
    gross_margin = revenue - materials
    operating = gross_margin - variable - groups["costi_fissi"] - groups["personale"] - groups["altri_operativi"]
    other = groups["altri_ricavi"] - groups["imposte"] - groups["altre_componenti"]
    result = operating - groups["oneri_finanziari"] + other

    def line(key, label, amount, drill=None, kind="cost", level=1, note=None):
        return {"key": key, "label": label, "amount": q2(amount), "drill": drill, "kind": kind, "level": level,
                "pct": q2(amount / revenue * 100) if revenue else None, "note": note}

    lines = [
        line("vendite_lorde", "Vendite lorde (IVA inclusa)", sales["gross_sales"], "sales", "info", 2),
        line("sconti", "− Sconti applicati", sales["discounts"], "discounts", "info", 2),
        line("rimborsi", "− Rimborsi e storni", sales["refunds"], "refunds", "info", 2),
        line("iva_vendite", "2. IVA sulle vendite (gestita a parte, non è un ricavo)", ZERO if forfettario else sales["vat_total"], "sales", "info", 2),
        line("ricavi", "1. Ricavi netti delle vendite", revenue, "sales", "revenue", 1),
        line("materie_prime", "3. Costo materie prime consumate", materials, "materials", "cost", 1,
             "Valore a costo medio dei consumi" if mat_method == "consumi" else "Acquisti registrati nel periodo"),
        line("margine_lordo", "4. Margine lordo", gross_margin, None, "subtotal", 0),
        line("costi_variabili", "5. Commissioni e altri costi variabili", variable, "variable", "cost", 1),
        line("costi_fissi", "6. Costi fissi", groups["costi_fissi"], "group:costi_fissi", "cost", 1,
             "Ripartiti per giorni" if prorate else None),
        line("personale", "7. Costi del personale", groups["personale"], "group:personale", "cost", 1,
             "Ripartiti per giorni" if prorate else None),
        line("altri_operativi", "8. Altri costi operativi", groups["altri_operativi"], "group:altri_operativi", "cost", 1),
        line("risultato_operativo", "9. Risultato operativo gestionale stimato", operating, None, "subtotal", 0),
        line("oneri_finanziari", "10. Interessi e oneri finanziari", groups["oneri_finanziari"], "group:oneri_finanziari", "cost", 1),
        line("altri_ricavi", "11a. Altri ricavi", groups["altri_ricavi"], "entries", "revenue", 2),
        line("imposte", "11b. Imposte e tributi registrati", groups["imposte"], "group:imposte", "cost", 2),
        line("altre_componenti", "11c. Altre componenti", groups["altre_componenti"], "entries", "cost", 2),
        line("risultato", "12. Risultato economico stimato del periodo", result, None, "result", 0),
    ]

    vat_out = ZERO if forfettario else D(sales["vat_total"])
    vat_in = ZERO
    if not forfettario:
        vat_in = D(c.val(
            "SELECT COALESCE(sum(vat_amount),0) FROM expenses WHERE voided_at IS NULL AND vat_deductible "
            "AND doc_date BETWEEN %s AND %s", [d1, d2]))
        if comm_from == "vendite":
            vat_in += D(sales["comm_vat"])

    return {
        "from": d1, "to": d2, "prorated": prorate,
        "criteria": {"materials": mat_method, "commissions": comm_from, "vat_regime": s.get("vat_regime")},
        "lines": lines,
        "totals": {
            "revenue": q2(revenue), "gross_sales": q2(sales["gross_total"]), "materials": q2(materials),
            "gross_margin": q2(gross_margin), "variable": q2(variable), "commissions": q2(commissions),
            "fixed": q2(groups["costi_fissi"]), "personnel": q2(groups["personale"]),
            "other_operating": q2(groups["altri_operativi"]), "operating": q2(operating),
            "financial": q2(groups["oneri_finanziari"]), "result": q2(result), "n_sales": sales["n_sales"],
            "theoretical_cost": q2(sales["theoretical_cost"]),
            "expenses_total": q2(sum(groups[g] for g in ("costi_variabili", "costi_fissi", "personale",
                                                          "altri_operativi", "oneri_finanziari", "imposte"))),
        },
        "vat": {"output": q2(vat_out), "input": q2(vat_in), "balance": q2(vat_out - vat_in)},
        "excluded": {k: q2(v) for k, v in excluded.items()},
        "summary_mode_gross": q2(sales["summary_mode_gross"]),
    }


def account_balances(c: db.Cursor, at: dt.date) -> list[dict]:
    return c.all(
        """SELECT a.id, a.name, a.kind,
             (CASE WHEN a.opening_date <= %s THEN a.opening_balance ELSE 0 END)
             + COALESCE((SELECT sum(sp.amount) FROM sale_payments sp WHERE sp.account_id=a.id
                          AND sp.status='incassato' AND sp.settlement_id IS NULL AND sp.received_at <= %s),0)
             + COALESCE((SELECT sum(st.amount) FROM settlements st WHERE st.account_id=a.id
                          AND st.voided_at IS NULL AND st.received_at <= %s),0)
             - COALESCE((SELECT sum(ep.amount) FROM expense_payments ep WHERE ep.account_id=a.id
                          AND ep.voided_at IS NULL AND ep.paid_at <= %s),0)
             + COALESCE((SELECT sum(cm.amount) FROM cash_movements cm WHERE cm.account_id=a.id
                          AND cm.voided_at IS NULL AND cm.moved_at <= %s),0) AS balance
           FROM accounts a WHERE a.is_active ORDER BY a.id""",
        [at, at, at, at, at],
    )


def liquidity(c: db.Cursor, d1: dt.date, d2: dt.date) -> dict:
    sales_in = D(c.val(
        "SELECT COALESCE(sum(amount),0) FROM sale_payments WHERE status='incassato' AND settlement_id IS NULL "
        "AND received_at BETWEEN %s AND %s", [d1, d2]))
    settl_in = D(c.val(
        "SELECT COALESCE(sum(amount),0) FROM settlements WHERE voided_at IS NULL AND received_at BETWEEN %s AND %s",
        [d1, d2]))
    exp_out = D(c.val(
        "SELECT COALESCE(sum(amount),0) FROM expense_payments WHERE voided_at IS NULL AND paid_at BETWEEN %s AND %s",
        [d1, d2]))
    other = c.one(
        """SELECT COALESCE(sum(amount) FILTER (WHERE amount>0 AND kind<>'giroconto'),0) AS other_in,
                  COALESCE(-sum(amount) FILTER (WHERE amount<0 AND kind<>'giroconto'),0) AS other_out
           FROM cash_movements WHERE voided_at IS NULL AND moved_at BETWEEN %s AND %s""",
        [d1, d2])
    receivables = D(c.val(
        """SELECT COALESCE(sum(sp.amount),0) FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
           WHERE s.status='valida' AND s.business_date <= %s
             AND (sp.status='in_attesa' OR (sp.status='incassato' AND sp.received_at > %s))""",
        [d2, d2]))
    payables = D(c.val(
        """SELECT COALESCE(sum(e.total_amount - COALESCE((SELECT sum(p.amount) FROM expense_payments p
                    WHERE p.expense_id=e.id AND p.voided_at IS NULL AND p.paid_at <= %s),0)),0)
           FROM expenses e WHERE e.voided_at IS NULL AND e.doc_date <= %s""",
        [d2, d2]))
    balances = account_balances(c, d2)
    entries = sales_in + settl_in + D(other["other_in"])
    exits = exp_out + D(other["other_out"])
    return {
        "inflows": q2(entries), "inflows_sales": q2(sales_in), "inflows_settlements": q2(settl_in),
        "inflows_other": q2(other["other_in"]),
        "outflows": q2(exits), "outflows_expenses": q2(exp_out), "outflows_other": q2(other["other_out"]),
        "net_cash_flow": q2(entries - exits),
        "receivables": q2(receivables), "payables": q2(payables),
        "accounts": balances, "cash_total": q2(sum(D(b["balance"]) for b in balances)),
        "stock_value": q2(stock.stock_value_at(c, d2)),
    }


def _e(v) -> str:
    s = f"{D(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} €"


def _n(v) -> str:
    return f"{D(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def consistency_checks(c: db.Cursor, d1: dt.date, d2: dt.date, pl: dict | None = None) -> list[dict]:
    checks = []
    r = c.one(
        """SELECT COALESCE(sum(s.gross_total),0) AS head,
                  COALESCE((SELECT sum(l.line_total) FROM sale_lines l JOIN sales s2 ON s2.id=l.sale_id
                            WHERE s2.status='valida' AND s2.business_date BETWEEN %s AND %s),0) AS lines,
                  COALESCE((SELECT sum(p.amount) FROM sale_payments p JOIN sales s3 ON s3.id=p.sale_id
                            WHERE s3.status='valida' AND p.status<>'annullato'
                              AND s3.business_date BETWEEN %s AND %s),0) AS pays,
                  COALESCE(sum(s.net_total + s.vat_total - s.gross_total),0) AS vat_diff
           FROM sales s WHERE s.status='valida' AND s.business_date BETWEEN %s AND %s""",
        [d1, d2, d1, d2, d1, d2],
    )
    checks.append({"label": "Totale vendite = somma delle righe", "ok": D(r["head"]) == D(r["lines"]),
                   "detail": f"vendite {_e(r['head'])}, righe {_e(r['lines'])}"})
    checks.append({"label": "Totale vendite = somma dei pagamenti registrati", "ok": D(r["head"]) == D(r["pays"]),
                   "detail": f"vendite {_e(r['head'])}, pagamenti {_e(r['pays'])}"})
    checks.append({"label": "Imponibile + IVA = totale vendite", "ok": D(r["vat_diff"]) == 0,
                   "detail": f"differenza {_e(r['vat_diff'])}"})

    moves_value = D(c.val("SELECT COALESCE(sum(value),0) FROM stock_movements"))
    items_value = D(c.val("SELECT COALESCE(sum(qty_on_hand * avg_cost),0) FROM items"))
    diff = q2(moves_value - items_value)
    checks.append({
        "label": "Valore scorte: movimenti = giacenze × costo medio", "ok": abs(diff) <= Decimal("0.05"),
        "warning": True,
        "detail": f"da movimenti {_e(moves_value)}, da giacenze {_e(items_value)} (differenza {_e(diff)})"
                  + (" – di norma dovuta a giacenze andate sotto zero e poi ricaricate a un costo diverso"
                     if abs(diff) > Decimal("0.05") else ""),
    })
    qty_mismatch = c.val(
        """SELECT count(*) FROM items i WHERE i.qty_on_hand <>
             COALESCE((SELECT sum(qty) FROM stock_movements m WHERE m.item_id=i.id),0)""")
    checks.append({"label": "Giacenze = somma dei movimenti", "ok": qty_mismatch == 0,
                   "detail": "tutti gli articoli coerenti" if qty_mismatch == 0 else f"{qty_mismatch} articoli incoerenti"})
    unlinked = D(c.val(
        """SELECT COALESCE(sum(e.net_amount),0) FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
           WHERE e.voided_at IS NULL AND ec.is_inventory AND e.receipt_id IS NULL
             AND e.competence_date BETWEEN %s AND %s""", [d1, d2]))
    method = c.val("SELECT value FROM settings WHERE key='materials_cost_method'")
    if method == "consumi":
        checks.append({
            "label": "Acquisti di magazzino caricati in giacenza", "ok": unlinked == 0, "warning": True,
            "detail": "tutti collegati" if unlinked == 0 else
            f"{_e(unlinked)} di spese per materie prime non collegate a un carico di magazzino: "
            "il loro costo entrerà nel conto economico solo quando la merce verrà caricata e consumata",
        })
    return checks


# ------------------------------------------------------------------ dashboard / serie

def daily_series(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    rows = c.all(
        """SELECT d::date AS day,
             COALESCE((SELECT sum(gross_total) FROM sales WHERE status='valida' AND business_date=d::date),0) AS gross,
             COALESCE((SELECT sum(net_total) FROM sales WHERE status='valida' AND business_date=d::date),0) AS net,
             COALESCE((SELECT sum(amount) FROM sale_payments sp WHERE sp.status='incassato' AND sp.settlement_id IS NULL
                         AND sp.received_at=d::date),0)
             + COALESCE((SELECT sum(amount) FROM settlements st WHERE st.voided_at IS NULL AND st.received_at=d::date),0) AS received,
             COALESCE((SELECT sum(amount) FROM expense_payments ep WHERE ep.voided_at IS NULL AND ep.paid_at=d::date),0) AS paid
           FROM generate_series(%s::date, %s::date, interval '1 day') d ORDER BY 1""",
        [d1, d2],
    )
    return rows


def monthly_series(c: db.Cursor, last: dt.date, months: int = 12) -> list[dict]:
    out = []
    start = add_months(month_start(last), -(months - 1))
    for k in range(months):
        ms = add_months(start, k)
        me = month_end(ms)
        pl = profit_and_loss(c, ms, me)
        t = pl["totals"]
        out.append({"month": ms, "revenue": t["revenue"], "gross_sales": t["gross_sales"], "materials": t["materials"],
                    "costs": q2(t["materials"] + t["variable"] + t["fixed"] + t["personnel"] + t["other_operating"]
                                + t["financial"]),
                    "result": t["result"]})
    return out


# ------------------------------------------------------------------ analisi

def product_analysis(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    return c.all(
        """SELECT p.id, p.name, pc.name AS category,
                  sum(l.qty) AS qty, sum(l.line_total) AS gross, sum(l.line_net) AS net,
                  sum(l.qty * l.unit_cost) AS cost, sum(l.line_net) - sum(l.qty * l.unit_cost) AS margin,
                  CASE WHEN sum(l.line_net) > 0 THEN round(sum(l.qty*l.unit_cost) / sum(l.line_net) * 100, 1) END AS food_cost_pct,
                  sum(l.discount) AS discounts
           FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id
           LEFT JOIN product_categories pc ON pc.id=p.category_id
           WHERE s.status='valida' AND s.kind='vendita' AND s.business_date BETWEEN %s AND %s
           GROUP BY p.id, p.name, pc.name ORDER BY qty DESC""",
        [d1, d2],
    )


def ingredient_consumption(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    types = list(stock.CONSUMPTION_TYPES - {"produzione_carico"})
    return c.all(
        f"""SELECT i.id, i.name, i.unit_code,
                   -sum(m.qty) FILTER (WHERE {stock.EFFECTIVE_TYPE_SQL} IN ('consumo_vendita','produzione_scarico')) AS theoretical_qty,
                   -sum(m.qty) FILTER (WHERE {stock.EFFECTIVE_TYPE_SQL} = 'spreco') AS waste_qty,
                   -sum(m.qty) FILTER (WHERE {stock.EFFECTIVE_TYPE_SQL} = 'scarico') AS manual_qty,
                   -sum(m.qty) FILTER (WHERE {stock.EFFECTIVE_TYPE_SQL} = 'rettifica_inventario') AS count_diff_qty,
                   -sum(m.qty) AS total_qty, -sum(m.value) AS total_value
            FROM {stock.MOVES_FROM} JOIN items i ON i.id=m.item_id
            WHERE (m.at AT TIME ZONE 'Europe/Rome')::date BETWEEN %s AND %s
              AND {stock.EFFECTIVE_TYPE_SQL} = ANY(%s::text[])
            GROUP BY i.id ORDER BY total_value DESC NULLS LAST""",
        [d1, d2, types],
    )


def expenses_by_category(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    s = get_settings(c)
    allocs = expense_allocations(c, d1, d2, s, not whole_months(d1, d2))
    agg: dict = {}
    for a in allocs:
        k = a["category_id"]
        x = agg.setdefault(k, {"category_id": k, "category": a["category"], "pl_group": a["pl_group"],
                               "amount": ZERO, "count": 0, "in_pl": True})
        x["amount"] += a["amount"]
        x["count"] += 1
        if (a["is_inventory"] and s.get("materials_cost_method") == "consumi") or a["pl_group"] == "non_economica" \
                or (a["is_platform_commission"] and s.get("platform_commissions_from", "vendite") == "vendite"):
            x["in_pl"] = False
    for x in agg.values():
        x["amount"] = q2(x["amount"])
    return sorted(agg.values(), key=lambda x: -x["amount"])


def channel_analysis(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    return c.all(
        """SELECT ch.id, ch.name, count(*) FILTER (WHERE s.kind='vendita') AS n,
                  COALESCE(sum(s.gross_total),0) AS gross, COALESCE(sum(s.net_total),0) AS net,
                  COALESCE(sum(s.commission_gross),0) AS commission,
                  CASE WHEN sum(s.gross_total) > 0 THEN round(sum(s.commission_gross)/sum(s.gross_total)*100,1) END AS commission_pct,
                  COALESCE(sum(s.net_total - s.commission_net - s.cost_total),0) AS contribution
           FROM sales s JOIN sales_channels ch ON ch.id=s.channel_id
           WHERE s.status='valida' AND s.business_date BETWEEN %s AND %s
           GROUP BY ch.id, ch.name ORDER BY gross DESC""",
        [d1, d2],
    )


WEEKDAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]


def weekday_analysis(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    rows = c.all(
        """SELECT EXTRACT(ISODOW FROM business_date)::int AS dow, count(DISTINCT business_date) AS days,
                  COALESCE(sum(gross_total),0) AS gross, COALESCE(sum(net_total - commission_net - cost_total),0) AS contribution
           FROM sales WHERE status='valida' AND business_date BETWEEN %s AND %s GROUP BY 1""",
        [d1, d2],
    )
    by = {r["dow"]: r for r in rows}
    out = []
    for i, name in enumerate(WEEKDAYS, start=1):
        r = by.get(i, {"days": 0, "gross": 0, "contribution": 0})
        days = r["days"] or 0
        out.append({"dow": i, "name": name, "days": days, "gross": q2(r["gross"]),
                    "avg_gross": q2(D(r["gross"]) / days) if days else ZERO,
                    "avg_contribution": q2(D(r["contribution"]) / days) if days else ZERO})
    return out


def hourly_analysis(c: db.Cursor, d1: dt.date, d2: dt.date) -> list[dict]:
    return c.all(
        """SELECT EXTRACT(HOUR FROM sold_at)::int AS hour, count(*) AS n, COALESCE(sum(gross_total),0) AS gross
           FROM sales WHERE status='valida' AND kind='vendita' AND mode='analitica'
             AND business_date BETWEEN %s AND %s GROUP BY 1 ORDER BY 1""",
        [d1, d2],
    )


def top_days(c: db.Cursor, d1: dt.date, d2: dt.date, limit=10) -> list[dict]:
    return c.all(
        """SELECT business_date AS day, COALESCE(sum(gross_total),0) AS gross,
                  COALESCE(sum(net_total - commission_net - cost_total),0) AS contribution, count(*) AS n
           FROM sales WHERE status='valida' AND business_date BETWEEN %s AND %s
           GROUP BY 1 ORDER BY contribution DESC LIMIT %s""",
        [d1, d2, limit],
    )


def break_even(c: db.Cursor, ref_end: dt.date, months: int = 3) -> dict:
    """Punto di pareggio mensile: costi di struttura / margine di contribuzione %. Ipotesi esplicite."""
    d2 = month_end(add_months(month_start(ref_end), -1))
    d1 = add_months(month_start(d2), -(months - 1))
    pl = profit_and_loss(c, d1, d2)
    t = pl["totals"]
    rev = D(t["revenue"])
    contrib = rev - D(t["materials"]) - D(t["variable"])
    structure = (D(t["fixed"]) + D(t["personnel"]) + D(t["other_operating"]) + D(t["financial"])) / months
    ratio = contrib / rev if rev > 0 else ZERO
    be_net = structure / ratio if ratio > 0 else None
    avg_vat = (D(t["gross_sales"]) / rev) if rev > 0 else Decimal("1.10")
    days_open = c.val("SELECT count(DISTINCT business_date) FROM sales WHERE status='valida' AND business_date BETWEEN %s AND %s",
                      [d1, d2]) or 0
    days_per_month = Decimal(days_open) / months if days_open else Decimal(26)
    avg_ticket = D(c.val(
        "SELECT CASE WHEN count(*)>0 THEN sum(gross_total)/count(*) END FROM sales "
        "WHERE status='valida' AND kind='vendita' AND business_date BETWEEN %s AND %s", [d1, d2]) or 0)
    be_gross = be_net * avg_vat if be_net is not None else None
    return {
        "reference": {"from": d1, "to": d2, "months": months},
        "assumptions": [
            f"Costi di struttura medi mensili (fissi, personale, altri operativi, oneri finanziari) del periodo "
            f"{d1.strftime('%m/%Y')}–{d2.strftime('%m/%Y')}: {_e(structure)}",
            f"Margine di contribuzione medio: {_n(ratio * 100)}% dei ricavi netti "
            f"(ricavi − materie prime − commissioni e costi variabili)",
            f"Rapporto medio lordo/netto (IVA): {_n(avg_vat)}",
            f"Giorni di apertura medi al mese: {_n(days_per_month)}",
            "Si assume che il mix di prodotti e canali resti uguale a quello del periodo di riferimento",
        ],
        "monthly_structure_costs": q2(structure),
        "contribution_margin_pct": q2(ratio * 100),
        "break_even_net": q2(be_net) if be_net is not None else None,
        "break_even_gross": q2(be_gross) if be_gross is not None else None,
        "break_even_daily_gross": q2(be_gross / days_per_month) if be_gross is not None and days_per_month else None,
        "break_even_tickets": int(be_gross / avg_ticket) + 1 if be_gross and avg_ticket > 0 else None,
        "avg_ticket": q2(avg_ticket),
        "current_avg_monthly_revenue": q2(rev / months),
    }


def period_range(kind: str, year: int, n: int) -> tuple[dt.date, dt.date]:
    if kind == "mese":
        d1 = dt.date(year, n, 1)
        return d1, month_end(d1)
    if kind == "trimestre":
        d1 = dt.date(year, (n - 1) * 3 + 1, 1)
        return d1, month_end(add_months(d1, 2))
    return dt.date(year, 1, 1), dt.date(year, 12, 31)
