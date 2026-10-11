import React from "react";
import { qs } from "../api.js";
import { BarChart, BarList } from "../charts.jsx";
import * as F from "../fmt.js";
import { Badge, Button, DateRange, ErrorBox, Link, Loading, Notice, PageHeader, Stat, navigate, useApp, useData, useRangeState } from "../ui.jsx";

export default function Dashboard() {
  const { can, openDrill, user } = useApp();
  const [from, to, setRange] = useRangeState("mese");
  const { data: d, error, loading, reload } = useData(`/dashboard${qs({ from, to })}`);
  const t = F.todayISO();
  const drill = (metric, title, a = from, b = to) => () => openDrill(metric, a, b, title);
  const cmp = d?.compare?.previous;
  const ly = d?.compare?.last_year;
  const cmpLabel = cmp ? `vs ${F.date(cmp.from)}–${F.date(cmp.to)}` : "";

  return (
    <>
      <PageHeader title={`Ciao ${user.full_name.split(" ")[0]}`}
        sub={d?.finance ? "I numeri si aggiornano a ogni operazione registrata. Clicca su un valore per vedere da cosa è composto." : null}
        actions={<>
          {can("sales.create") && <Button variant="primary" onClick={() => navigate("/cassa")}>Registra vendita</Button>}
          {d?.finance && <DateRange from={from} to={to} onChange={setRange} />}
        </>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !d && <Loading />}
      {d && (
        <>
          {d.finance && d.kpi_fixed && (
            <div className="stats">
              <Stat tone="brand" label="Incasso di oggi" value={F.eur(d.kpi_fixed.today_gross)}
                sub={`incassato ${F.eur(d.kpi_fixed.today_received)}`} onClick={drill("gross_sales", "Vendite di oggi", t, t)} />
              <Stat label="Mese corrente" value={F.eur(d.kpi_fixed.month_gross)}
                sub={`stessi giorni mese scorso ${F.eur(d.kpi_fixed.prev_month_same_days_gross)}`}
                onClick={drill("gross_sales", "Vendite del mese", F.monthStart(t), t)} />
              <Stat label="Mese precedente" value={F.eur(d.kpi_fixed.prev_month_gross)}
                onClick={drill("gross_sales", "Vendite del mese precedente", F.addMonths(F.monthStart(t), -1), F.monthEnd(F.addMonths(F.monthStart(t), -1)))} />
              {can("sales.view") && (
                <Stat label="Chiusura di oggi" value={d.day_closed ? "Fatta" : "Da fare"} tone={d.day_closed ? "good" : undefined}
                  sub={`${d.today_ops?.n_sales ?? 0} vendite registrate`} onClick={() => navigate("/chiusura")} />
              )}
            </div>
          )}

          {d.finance && d.pl && (
            <section className="section">
              <h2>Periodo selezionato <span className="muted small" style={{ fontWeight: 400 }}>{F.date(from)} – {F.date(to)}</span></h2>
              {d.prorated && <p className="muted small">Costi fissi e personale sono ripartiti per giorni, per stimare l'utile anche su periodi brevi.</p>}
              <div className="stats" style={{ marginTop: 10 }}>
                <Stat label="Vendite (IVA inclusa)" value={F.eur(d.pl.gross_sales)} delta={cmp?.gross_sales} sub={cmpLabel} onClick={drill("gross_sales", "Vendite")} />
                <Stat label="Ricavi netti" value={F.eur(d.pl.revenue)} delta={cmp?.revenue} sub={`${d.pl.n_sales} vendite`} onClick={drill("sales", "Ricavi netti")} />
                <Stat label="Materie prime consumate" value={F.eur(d.pl.materials)} delta={cmp?.materials} deltaInverse
                  sub={d.pl.revenue ? `${F.pct((d.pl.materials / d.pl.revenue) * 100)} dei ricavi` : ""} onClick={drill("materials", "Costo materie prime consumate")} />
                <Stat label="Margine lordo stimato" value={F.eur(d.pl.gross_margin)} delta={cmp?.gross_margin}
                  sub={d.pl.revenue ? `${F.pct((d.pl.gross_margin / d.pl.revenue) * 100)} dei ricavi` : ""} />
                <Stat label="Spese a conto economico" value={F.eur(d.pl.expenses_total)} delta={cmp?.expenses_total} deltaInverse
                  onClick={drill("expenses_total", "Spese del periodo")} />
                <Stat label="Utile / perdita operativa" value={F.eur(d.pl.operating)} tone={Number(d.pl.operating) >= 0 ? "good" : "bad"}
                  delta={cmp?.operating} sub="stima gestionale" onClick={() => navigate(`/report?from=${from}&to=${to}`)} />
                <Stat label="Valore delle scorte" value={F.eur(d.liquidity.stock_value)} sub="a costo medio" onClick={drill("stock_value", "Valore delle scorte")} />
                <Stat label="Crediti da incassare" value={F.eur(d.liquidity.receivables)} sub="piattaforme e sospesi" onClick={drill("receivables", "Crediti da incassare")} />
                <Stat label="Debiti da pagare" value={F.eur(d.liquidity.payables)} onClick={drill("payables", "Debiti da pagare")} />
                <Stat label="Cassa e conti" value={F.eur(d.liquidity.cash_total)} sub={d.liquidity.accounts.map((a) => `${a.name} ${F.eur(a.balance)}`).join(", ")} />
              </div>
              {ly && ly.gross_sales.value > 0 && (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Stesso periodo dell'anno scorso: vendite {F.eur(ly.gross_sales.value)} ({ly.gross_sales.pct !== null ? `${ly.gross_sales.diff >= 0 ? "+" : ""}${F.pct(ly.gross_sales.pct)}` : "–"}),
                  risultato operativo {F.eur(ly.operating.value)}.
                </p>
              )}
            </section>
          )}

          <div className="dash-grid">
            <div className="stack">
              {d.finance && d.daily && (
                <div className="card">
                  <div className="card-head"><h2>Incassi e pagamenti giorno per giorno</h2></div>
                  <BarChart height={220}
                    data={d.daily.map((r) => ({ label: r.day.slice(8), tip: F.date(r.day), gross: r.gross, received: r.received, paid: r.paid, day: r.day }))}
                    series={[{ key: "gross", label: "Vendite", color: "var(--brand)" }, { key: "paid", label: "Spese pagate", color: "#c9a27a" }]}
                    line={{ key: "received", label: "Incassato", color: "var(--ink)" }}
                    onBarClick={(r) => openDrill("gross_sales", r.day, r.day, `Vendite del ${F.date(r.day)}`)} />
                </div>
              )}
              {d.finance && d.monthly && (
                <div className="card">
                  <div className="card-head"><h2>Ultimi 12 mesi: ricavi, costi e risultato</h2></div>
                  <BarChart height={230}
                    data={d.monthly.map((m) => ({ label: F.shortMonth(m.month), tip: F.monthLabel(m.month), revenue: m.revenue, costs: m.costs, result: m.result, month: m.month }))}
                    series={[{ key: "revenue", label: "Ricavi netti", color: "var(--brand)" }, { key: "costs", label: "Costi", color: "#c9a27a" }]}
                    line={{ key: "result", label: "Risultato", color: "var(--ink)" }}
                    onBarClick={(m) => navigate(`/report?from=${m.month}&to=${F.monthEnd(m.month)}`)} />
                </div>
              )}
              {d.finance && d.top_products?.length > 0 && (
                <div className="card">
                  <div className="card-head"><h2>Prodotti più venduti</h2><Link to={`/report?tab=analisi&from=${from}&to=${to}`}>Tutte le analisi</Link></div>
                  <BarList items={d.top_products} label={(p) => p.name} value={(p) => p.qty} format={(v) => `${F.num(v)} pz`}
                    sub={(p) => `· margine ${F.eur(p.margin)}`} />
                </div>
              )}
            </div>
            <div className="stack">
              {d.finance && (
                <div className="card">
                  <div className="card-head"><h2>Pagamenti in scadenza</h2><Link to="/spese?status=aperte">Tutte</Link></div>
                  {d.due.length === 0 ? <p className="muted">Nessuna scadenza nei prossimi giorni.</p> : (
                    <ul className="list-plain">
                      {d.due.map((e) => (
                        <li key={e.id}>
                          <Link to={`/spese/${e.id}`} style={{ color: "inherit", textDecoration: "none", minWidth: 0 }}>
                            <b style={{ fontWeight: 600 }}>{e.description}</b>
                            <span className="sub muted small" style={{ display: "block" }}>{e.supplier_name || ""} scade il {F.date(e.due_date)}</span>
                          </Link>
                          <span style={{ textAlign: "right" }}>{F.eur(e.residual)}<br />{e.overdue && <Badge tone="bad">Scaduta</Badge>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {d.low_stock && (
                <div className="card">
                  <div className="card-head"><h2>Sotto la scorta minima</h2><Link to="/magazzino?below_min=1">Magazzino</Link></div>
                  {d.low_stock.length === 0 ? <p className="muted">Tutte le scorte sono sopra il minimo.</p> : (
                    <ul className="list-plain">
                      {d.low_stock.map((i) => (
                        <li key={i.id}>
                          <Link to={`/magazzino/${i.id}`} style={{ color: "inherit" }}>{i.name}</Link>
                          <span className={Number(i.qty_on_hand) <= 0 ? "neg" : ""}>{F.num(i.qty_on_hand)} / {F.num(i.min_qty)} {i.unit_code}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {d.expiring?.length > 0 && (
                <div className="card">
                  <div className="card-head"><h2>Lotti in scadenza</h2></div>
                  <ul className="list-plain">
                    {d.expiring.map((l) => (
                      <li key={l.id}><span>{l.name}{l.lot_code ? ` (lotto ${l.lot_code})` : ""}</span>
                        <span>{F.num(l.qty_remaining)} {l.unit_code} · <b className={l.expiry_date < t ? "neg" : ""}>{F.date(l.expiry_date)}</b></span></li>
                    ))}
                  </ul>
                </div>
              )}
              {d.finance && d.vat && (
                <div className="card">
                  <div className="card-head"><h2>IVA stimata del periodo</h2></div>
                  <dl className="kv">
                    <dt>A debito (vendite)</dt><dd className="tabular">{F.eur(d.vat.output)}</dd>
                    <dt>A credito (acquisti)</dt><dd className="tabular">{F.eur(d.vat.input)}</dd>
                    <dt><b>Saldo</b></dt><dd className="tabular"><b>{F.eur(d.vat.balance)}</b></dd>
                  </dl>
                </div>
              )}
              {!d.finance && <Notice tone="info">I dati economici sono visibili solo agli utenti autorizzati.</Notice>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
