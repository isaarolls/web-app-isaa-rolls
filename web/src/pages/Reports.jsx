import React, { useState } from "react";
import { LuCircleCheck, LuCircleAlert, LuTriangleAlert, LuDownload, LuLock, LuLockOpen } from "react-icons/lu";
import { api, qs } from "../api.js";
import { BarChart, BarList } from "../charts.jsx";
import * as F from "../fmt.js";
import { Badge, Button, ConfirmModal, DataTable, DateRange, ErrorBox, Field, Loading, Notice, PageHeader, Select, Tabs, useAction, useApp, useData } from "../ui.jsx";

export function Reports({ query }) {
  const [tab, setTab] = useState(query.tab || "mensile");
  return (
    <>
      <PageHeader title="Report" sub="Stima gestionale: non sostituisce il bilancio fiscale. I criteri di calcolo si impostano in Impostazioni d'accordo con il commercialista." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "mensile", label: "Conto economico" }, { value: "confronto", label: "Confronti" }, { value: "analisi", label: "Analisi" }]} />
      {tab === "mensile" && <Monthly query={query} />}
      {tab === "confronto" && <Compare />}
      {tab === "analisi" && <Analysis query={query} />}
    </>
  );
}

function MonthPicker({ value, onChange }) {
  const y0 = Number(F.todayISO().slice(0, 4));
  const [y, m] = value.split("-").map(Number);
  return (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      <span style={{ width: 140 }}><Select value={m} onChange={(v) => onChange(`${y}-${String(v).padStart(2, "0")}-01`)} options={F.MONTHS.map((n, i) => ({ value: i + 1, label: n }))} /></span>
      <span style={{ width: 100 }}><Select value={y} onChange={(v) => onChange(`${v}-${String(m).padStart(2, "0")}-01`)} options={Array.from({ length: 8 }, (_, i) => ({ value: y0 - i, label: String(y0 - i) }))} /></span>
    </div>
  );
}

function Monthly({ query }) {
  const { can, openDrill } = useApp();
  const [mode, setMode] = useState(query.from && !(query.from.endsWith("-01") && query.to === F.monthEnd(query.from)) ? "range" : "month");
  const [month, setMonth] = useState(query.from ? query.from.slice(0, 8) + "01" : F.monthStart());
  const [range, setRange] = useState({ from: query.from || F.monthStart(), to: query.to || F.todayISO() });
  const from = mode === "month" ? month : range.from;
  const to = mode === "month" ? F.monthEnd(month) : range.to;
  const { data: p, error, loading, reload } = useData(`/reports/pl${qs({ from, to })}`);
  const [closing, setClosing] = useState(null);
  const [run, busy] = useAction();
  const ym = from.slice(0, 7);
  const isWholeMonth = mode === "month";
  const monthOver = F.monthEnd(month) < F.todayISO();
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span style={{ width: 170 }}><Select value={mode} onChange={setMode} options={[{ value: "month", label: "Mese" }, { value: "range", label: "Periodo libero" }]} /></span>
        {mode === "month" ? <MonthPicker value={month} onChange={setMonth} /> : <DateRange from={range.from} to={range.to} onChange={(a, b) => setRange({ from: a, to: b })} />}
        <span className="spacer" />
        {can("reports.export") && <>
          <Button icon={LuDownload} onClick={() => api.download(`/reports/pl.pdf${qs({ from, to })}`, `report-${from}.pdf`)}>PDF</Button>
          <Button icon={LuDownload} onClick={() => api.download(`/reports/pl.xlsx${qs({ from, to })}`, `report-${from}.xlsx`)}>Excel</Button>
        </>}
        {isWholeMonth && can("periods.close") && p && (p.closed
          ? <Button icon={LuLockOpen} onClick={() => setClosing("open")}>Riapri il mese</Button>
          : monthOver && <Button icon={LuLock} onClick={() => setClosing("close")}>Chiudi il mese</Button>)}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !p ? <Loading /> : p && (
        <>
          {p.closed && <Notice tone="info">Mese chiuso il {F.datetime(p.closed.closed_at)} da {p.closed.closed_by_name}: non si possono più registrare o modificare operazioni con data in questo mese.</Notice>}
          {p.prorated && <Notice tone="info">Il periodo non copre mesi interi: costi fissi e personale sono ripartiti in proporzione ai giorni.</Notice>}
          <div className="dash-grid" style={{ marginTop: 0 }}>
            <div className="card">
              <div className="card-head"><h2>Conto economico gestionale</h2><span className="muted small">{F.date(from)} – {F.date(to)} · clicca una voce per il dettaglio</span></div>
              <table className="pl">
                <tbody>
                  {p.lines.map((l) => (
                    <tr key={l.key} className={`${l.level === 2 ? "lvl2" : ""} ${l.kind === "subtotal" ? "subtotal" : ""} ${l.kind === "result" ? "result" : ""} ${l.drill ? "drill" : ""}`}
                      onClick={l.drill ? () => openDrill(l.drill, from, to, l.label.replace(/^\d+[a-z]?\.\s*/, "")) : undefined}>
                      <td>{l.label}{l.note && <span className="note">{l.note}</span>}</td>
                      <td className={`r ${l.kind === "result" || l.kind === "subtotal" ? (Number(l.amount) < 0 ? "neg" : "pos") : ""}`}>{F.eur(l.amount)}</td>
                      <td className="r muted small" style={{ width: 70 }}>{l.pct !== null && l.level < 2 ? F.pct(l.pct) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {Object.keys(p.excluded || {}).length > 0 && (
                <p className="muted small" style={{ marginTop: 12 }}>Esclusi per evitare doppi conteggi:{" "}
                  {p.excluded.acquisti_magazzino !== undefined && <>acquisti di magazzino {F.eur(p.excluded.acquisti_magazzino)} (diventano costo quando la merce si consuma); </>}
                  {p.excluded.commissioni_fatturate !== undefined && <>fatture commissioni piattaforme {F.eur(p.excluded.commissioni_fatturate)} (già stimate sulle vendite); </>}
                  {p.excluded.non_economiche !== undefined && <>spese non economiche {F.eur(p.excluded.non_economiche)}.</>}
                </p>
              )}
              {Number(p.summary_mode_gross) > 0 && <p className="muted small">Di cui registrato come totale giornaliero (senza scarico magazzino): {F.eur(p.summary_mode_gross)}.</p>}
            </div>
            <div className="stack">
              <div className="card">
                <div className="card-head"><h2>Liquidità</h2></div>
                <p className="muted small">Il risultato economico non coincide con i soldi incassati: qui ci sono i movimenti di denaro reali.</p>
                <table className="plain-table"><tbody>
                  <tr className="drill" style={{ cursor: "pointer" }} onClick={() => openDrill("received", from, to, "Entrate monetarie")}><td>Entrate effettive</td><td className="r pos">{F.eur(p.liquidity.inflows)}</td></tr>
                  <tr style={{ cursor: "pointer" }} onClick={() => openDrill("paid", from, to, "Uscite per spese")}><td>Uscite effettive</td><td className="r neg">{F.eur(-p.liquidity.outflows)}</td></tr>
                  <tr><td><b>Flusso di cassa netto</b></td><td className="r"><b>{F.eur(p.liquidity.net_cash_flow)}</b></td></tr>
                  <tr style={{ cursor: "pointer" }} onClick={() => openDrill("receivables", from, to, "Crediti da incassare")}><td>Crediti da incassare a fine periodo</td><td className="r">{F.eur(p.liquidity.receivables)}</td></tr>
                  <tr style={{ cursor: "pointer" }} onClick={() => openDrill("payables", from, to, "Debiti da pagare")}><td>Debiti da pagare a fine periodo</td><td className="r">{F.eur(p.liquidity.payables)}</td></tr>
                  {p.liquidity.accounts.map((a) => <tr key={a.id}><td>Saldo {a.name}</td><td className="r">{F.eur(a.balance)}</td></tr>)}
                  <tr><td>Valore delle scorte a fine periodo</td><td className="r">{F.eur(p.liquidity.stock_value)}</td></tr>
                </tbody></table>
              </div>
              <div className="card">
                <div className="card-head"><h2>IVA stimata</h2></div>
                <dl className="kv"><dt>A debito</dt><dd className="tabular">{F.eur(p.vat.output)}</dd><dt>A credito</dt><dd className="tabular">{F.eur(p.vat.input)}</dd>
                  <dt><b>Saldo</b></dt><dd className="tabular"><b>{F.eur(p.vat.balance)}</b> {Number(p.vat.balance) > 0 ? "da versare" : "a credito"}</dd></dl>
              </div>
              <div className="card">
                <div className="card-head"><h2>Controlli automatici</h2></div>
                <ul className="list-plain check-list">{p.checks.map((c, i) => (
                  <li key={i} style={{ justifyContent: "flex-start", gap: 10 }}>
                    {c.ok ? <LuCircleCheck className="icon-good" /> : c.warning ? <LuTriangleAlert className="icon-warn" /> : <LuCircleAlert className="icon-bad" />}
                    <span><b style={{ fontWeight: 600 }}>{c.label}</b><span className="muted small" style={{ display: "block" }}>{c.detail}</span></span>
                  </li>))}</ul>
              </div>
            </div>
          </div>
          {p.expenses_by_category.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-head"><h2>Spese per categoria</h2></div>
              <BarList items={p.expenses_by_category} label={(e) => e.category + (e.in_pl ? "" : " (non a C.E.)")} value={(e) => e.amount} />
            </div>
          )}
        </>
      )}
      {closing && <ConfirmModal title={closing === "close" ? "Chiudi il mese" : "Riapri il mese"} danger={closing === "open"}
        message={closing === "close" ? `Dopo la chiusura di ${F.monthLabel(month)} non sarà più possibile registrare o modificare vendite, spese e movimenti con data in quel mese. Il risultato attuale viene salvato come riferimento.`
          : "Riaprendo il mese torneranno possibili modifiche ai dati: la riapertura resta registrata nello storico."}
        confirmLabel={closing === "close" ? "Chiudi il mese" : "Riapri il mese"} onClose={() => setClosing(null)}
        onConfirm={async () => { const ok = await run(() => (closing === "close" ? api.post(`/periods/${ym}/close`) : api.del(`/periods/${ym}/close`)), closing === "close" ? "Mese chiuso" : "Mese riaperto"); if (ok) reload(); return ok; }} />}
    </>
  );
}

function Compare() {
  const y = Number(F.todayISO().slice(0, 4));
  const m = Number(F.todayISO().slice(5, 7));
  const [kind, setKind] = useState("mese");
  const [a, setA] = useState({ year: y, n: m });
  const [b, setB] = useState({ year: m === 1 ? y - 1 : y, n: m === 1 ? 12 : m - 1 });
  const { data, error, loading } = useData(`/reports/compare${qs({ kind, a_year: a.year, a_n: a.n, b_year: b.year, b_n: b.n })}`);
  const nOpts = kind === "mese" ? F.MONTHS.map((x, i) => ({ value: i + 1, label: x })) : kind === "trimestre" ? [1, 2, 3, 4].map((q) => ({ value: q, label: `${q}° trimestre` })) : [{ value: 1, label: "Anno intero" }];
  const yOpts = Array.from({ length: 8 }, (_, i) => ({ value: y - i, label: String(y - i) }));
  const picker = (v, set) => (
    <div className="row" style={{ flexWrap: "nowrap" }}>
      {kind !== "anno" && <span style={{ width: 150 }}><Select value={v.n} onChange={(n) => set({ ...v, n: Number(n) })} options={nOpts} /></span>}
      <span style={{ width: 100 }}><Select value={v.year} onChange={(yy) => set({ ...v, year: Number(yy) })} options={yOpts} /></span>
    </div>
  );
  const setK = (k) => {
    setKind(k);
    if (k === "anno") { setA({ year: y, n: 1 }); setB({ year: y - 1, n: 1 }); }
    if (k === "trimestre") { const q = Math.ceil(m / 3); setA({ year: y, n: q }); setB({ year: q === 1 ? y - 1 : y, n: q === 1 ? 4 : q - 1 }); }
    if (k === "mese") { setA({ year: y, n: m }); setB({ year: m === 1 ? y - 1 : y, n: m === 1 ? 12 : m - 1 }); }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span style={{ width: 150 }}><Select value={kind} onChange={setK} options={[{ value: "mese", label: "Due mesi" }, { value: "trimestre", label: "Due trimestri" }, { value: "anno", label: "Due anni" }]} /></span>
        <b>A</b>{picker(a, setA)}<b>B</b>{picker(b, setB)}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : data && (
        <div className="card">
          <table className="pl">
            <thead><tr><td /><td className="r"><b>A</b> <span className="muted small">{F.date(data.a.from)}–{F.date(data.a.to)}</span></td>
              <td className="r"><b>B</b> <span className="muted small">{F.date(data.b.from)}–{F.date(data.b.to)}</span></td><td className="r">Differenza</td><td className="r">Var. %</td></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className={`${r.level === 2 ? "lvl2" : ""} ${r.kind === "subtotal" ? "subtotal" : ""} ${r.kind === "result" ? "result" : ""}`}>
                  <td>{r.label}</td><td className="r">{F.eur(r.a)}</td><td className="r">{F.eur(r.b)}</td>
                  <td className={`r ${Number(r.diff) === 0 ? "" : (Number(r.diff) > 0) === (r.kind !== "cost") ? "pos" : "neg"}`}>{F.eur(r.diff)}</td>
                  <td className="r muted">{r.pct !== null ? F.pct(r.pct) : "–"}</td>
                </tr>
              ))}
              <tr><td colSpan={5} style={{ paddingTop: 18 }}><b>Liquidità</b></td></tr>
              {data.liquidity.map((r) => <tr key={r.label}><td>{r.label}</td><td className="r">{F.eur(r.a)}</td><td className="r">{F.eur(r.b)}</td><td className="r">{F.eur(r.diff)}</td><td /></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Analysis({ query }) {
  const [range, setRange] = useState({ from: query.from || F.addMonths(F.monthStart(), -2), to: query.to || F.todayISO() });
  const { data: d, error, loading } = useData(`/reports/analysis${qs(range)}`);
  const { can } = useApp();
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><DateRange from={range.from} to={range.to} onChange={(a, b) => setRange({ from: a, to: b })} /></div>
      <ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && (
        <div className="stack">
          <BreakEven be={d.break_even} />
          <div className="grid g2">
            <div className="card"><div className="card-head"><h2>Prodotti più venduti</h2></div>
              {d.products.length ? <BarList items={d.products.slice(0, 12)} label={(p) => p.name} value={(p) => p.qty} format={(v) => `${F.num(v)} pz`} /> : <p className="muted">Nessuna vendita per prodotto.</p>}</div>
            <div className="card"><div className="card-head"><h2>Prodotti che generano più margine</h2></div>
              {d.products.length ? <BarList items={[...d.products].sort((a, b) => b.margin - a.margin).slice(0, 12)} label={(p) => p.name} value={(p) => p.margin} sub={(p) => `· food cost ${F.pct(p.food_cost_pct)}`} /> : <p className="muted">Nessun dato.</p>}</div>
          </div>
          <div>
            <h2 style={{ marginBottom: 8 }}>Costo dei prodotti rispetto al prezzo</h2>
            <DataTable rows={d.product_costs} search={false} rowClass={(r) => (r.over_target ? "warn" : "")} columns={[
              { key: "name", label: "Prodotto", render: (r) => <><a href={`#/prodotti/${r.id}`}>{r.name}</a>{!r.has_recipe && <> <Badge tone="bad">senza ricetta</Badge></>}{r.missing_costs > 0 && <> <Badge tone="warn">costi mancanti</Badge></>}</> },
              { key: "sale_price", label: "Prezzo", type: "money" }, { key: "unit_cost", label: "Costo diretto", type: "money" },
              { key: "food_cost_pct", label: "Food cost", type: "pct" }, { key: "gross_margin", label: "Margine unitario", type: "money" },
              { key: "suggested_price", label: "Prezzo consigliato", type: "money" },
              { key: "over_target", label: "", sortable: false, render: (r) => r.over_target && <Badge tone="warn">sotto il margine obiettivo</Badge> }]} />
          </div>
          <div>
            <h2 style={{ marginBottom: 8 }}>Ingredienti consumati</h2>
            <p className="muted small">Consumo teorico (da ricette e produzioni) a confronto con sprechi, scarichi manuali e differenze di inventario.</p>
            <DataTable rows={d.ingredients} search={false} empty="Nessun consumo nel periodo" columns={[
              { key: "name", label: "Articolo" },
              { key: "theoretical_qty", label: "Teorico", align: "right", render: (r) => `${F.num(r.theoretical_qty || 0)} ${r.unit_code}` },
              { key: "waste_qty", label: "Sprechi", align: "right", render: (r) => r.waste_qty ? `${F.num(r.waste_qty)} ${r.unit_code}` : "" },
              { key: "manual_qty", label: "Scarichi manuali", align: "right", render: (r) => r.manual_qty ? `${F.num(r.manual_qty)} ${r.unit_code}` : "" },
              { key: "count_diff_qty", label: "Diff. inventario", align: "right", render: (r) => r.count_diff_qty ? `${F.num(r.count_diff_qty)} ${r.unit_code}` : "" },
              { key: "total_qty", label: "Totale", align: "right", render: (r) => `${F.num(r.total_qty)} ${r.unit_code}` },
              can("inventory.costs") && { key: "total_value", label: "Costo", type: "money" }].filter(Boolean)} />
          </div>
          <div className="grid g2">
            <div className="card"><div className="card-head"><h2>Spese più onerose</h2></div>
              <BarList items={d.expense_categories.filter((e) => e.in_pl)} label={(e) => e.category} value={(e) => e.amount} /></div>
            <div className="card"><div className="card-head"><h2>Incidenza delle commissioni per canale</h2></div>
              <table className="plain-table"><thead><tr><th>Canale</th><th className="r">Vendite</th><th className="r">Commissioni</th><th className="r">%</th><th className="r">Contribuzione</th></tr></thead>
                <tbody>{d.channels.map((c) => <tr key={c.id}><td>{c.name}</td><td className="r">{F.eur(c.gross)}</td><td className="r">{F.eur(c.commission)}</td><td className="r">{F.pct(c.commission_pct)}</td><td className="r">{F.eur(c.contribution)}</td></tr>)}</tbody></table>
              <p className="muted small" style={{ marginTop: 8 }}>Contribuzione = ricavi netti − commissioni − costo teorico delle materie prime.</p></div>
          </div>
          <div className="grid g2">
            <div className="card"><div className="card-head"><h2>Incasso medio per giorno della settimana</h2></div>
              <BarChart height={200} data={d.weekdays.map((w) => ({ label: w.name.slice(0, 3), tip: `${w.name} (${w.days} giorni)`, avg: w.avg_gross, contr: w.avg_contribution }))}
                series={[{ key: "avg", label: "Vendite medie", color: "var(--brand)" }, { key: "contr", label: "Contribuzione media", color: "var(--brand-pantone)" }]} /></div>
            <div className="card"><div className="card-head"><h2>Fasce orarie</h2></div>
              {d.hours.length ? <BarChart height={200} data={d.hours.map((h) => ({ label: `${h.hour}`, tip: `${h.hour}:00–${h.hour}:59 · ${h.n} vendite`, gross: h.gross }))}
                series={[{ key: "gross", label: "Vendite", color: "var(--brand)" }]} /> : <p className="muted">Disponibile per le vendite registrate prodotto per prodotto.</p>}</div>
          </div>
          <div className="card"><div className="card-head"><h2>Giornate più redditizie</h2></div>
            <table className="plain-table"><thead><tr><th>Giorno</th><th className="r">Vendite</th><th className="r">Contribuzione</th><th className="r">N.</th></tr></thead>
              <tbody>{d.top_days.map((t) => <tr key={t.day}><td>{F.date(t.day)}</td><td className="r">{F.eur(t.gross)}</td><td className="r">{F.eur(t.contribution)}</td><td className="r">{t.n}</td></tr>)}</tbody></table></div>
        </div>
      )}
    </>
  );
}

function BreakEven({ be }) {
  const ok = be.break_even_gross !== null;
  const progress = ok && be.break_even_net ? Math.min(100, (Number(be.current_avg_monthly_revenue) / Number(be.break_even_net)) * 100) : 0;
  return (
    <div className="card">
      <div className="card-head"><h2>Quanto bisogna incassare per coprire i costi</h2><span className="muted small">riferimento {F.date(be.reference.from)}–{F.date(be.reference.to)}</span></div>
      {!ok ? <p className="muted">Servono almeno un mese completo di vendite e costi registrati per stimare il punto di pareggio.</p> : (
        <>
          <div className="stats">
            <div className="stat stat-brand"><span className="stat-label">Punto di pareggio mensile</span><span className="stat-value">{F.eur(be.break_even_gross)}</span><span className="stat-sub">vendite IVA inclusa ({F.eur(be.break_even_net)} netti)</span></div>
            <div className="stat"><span className="stat-label">Al giorno di apertura</span><span className="stat-value">{F.eur(be.break_even_daily_gross)}</span></div>
            <div className="stat"><span className="stat-label">Scontrini necessari al mese</span><span className="stat-value">{be.break_even_tickets ?? "–"}</span><span className="stat-sub">scontrino medio {F.eur(be.avg_ticket)}</span></div>
            <div className="stat"><span className="stat-label">Ricavi netti medi attuali</span><span className="stat-value">{F.eur(be.current_avg_monthly_revenue)}</span><span className="stat-sub">{F.pct(progress)} del pareggio</span></div>
          </div>
          <div className="bar-track" style={{ height: 12, marginTop: 14 }}><div className="bar-fill" style={{ width: `${progress}%`, background: progress >= 100 ? "var(--good)" : "var(--brand)" }} /></div>
        </>
      )}
      <h3 style={{ marginTop: 14 }}>Ipotesi del calcolo</h3>
      <ul className="small muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{be.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
    </div>
  );
}
