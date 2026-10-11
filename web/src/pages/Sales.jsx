import React, { useState } from "react";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, DataTable, DateRange, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader, ReasonModal,
  Select, navigate, useAction, useApp, useData, useRangeState,
} from "../ui.jsx";

export function SalesList() {
  const { can, openDrill } = useApp();
  const [from, to, setRange] = useRangeState("oggi");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const look = useData("/lookups");
  const { data, error, loading, reload } = useData(`/sales${qs({ from, to, channel_id: channel, status, limit: 3000 })}`);
  const rows = data || [];
  const valid = rows.filter((r) => r.status === "valida");
  const tot = valid.reduce((s, r) => s + Number(r.gross_total), 0);
  return (
    <>
      <PageHeader title="Vendite" sub="Ogni vendita registrata, con canale, pagamento e stato."
        actions={<>
          {can("sales.close_day") && <Button onClick={() => navigate("/chiusura")}>Chiusura di cassa</Button>}
          {can("sales.create") && <Button variant="primary" onClick={() => navigate("/cassa")}>Nuova vendita</Button>}
        </>} />
      <div className="row" style={{ marginBottom: 12 }}>
        <DateRange from={from} to={to} onChange={setRange} />
        <span style={{ width: 180 }}><Select value={channel} onChange={setChannel} placeholder="Tutti i canali"
          options={(look.data?.channels || []).map((c) => ({ value: c.id, label: c.name }))} /></span>
        <span style={{ width: 160 }}><Select value={status} onChange={setStatus} placeholder="Tutti gli stati"
          options={[{ value: "valida", label: "Valide" }, { value: "annullata", label: "Annullate" }]} /></span>
        <span className="spacer" />
        <b className="tabular">{valid.length} vendite · {F.eur(tot)}</b>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={rows} onRowClick={(r) => navigate(`/vendite/${r.id}`)} rowClass={(r) => (r.status === "annullata" ? "voided" : "")}
          empty="Nessuna vendita nel periodo"
          columns={[
            { key: "number", label: "N.", width: 70 },
            { key: "sold_at", label: "Data e ora", type: "datetime" },
            { key: "items_text", label: "Prodotti", render: (r) => (
              <span>{r.items_text}{r.kind === "rimborso" && <> <Badge tone="warn">Rimborso</Badge></>}
                {r.mode === "riepilogo" && r.kind === "vendita" && <> <Badge tone="info">Totale giornaliero</Badge></>}</span>) },
            { key: "channel_name", label: "Canale" },
            { key: "methods_text", label: "Pagamento", render: (r) => <>{r.methods_text}{Number(r.pending_amount) !== 0 && <> <Badge tone="warn">Da incassare</Badge></>}</> },
            { key: "discount_total", label: "Sconto", type: "money" },
            { key: "gross_total", label: "Totale", type: "money" },
            { key: "user_name", label: "Utente" },
            { key: "status", label: "Stato", render: (r) => r.status === "annullata" ? <Badge tone="bad">Annullata</Badge> : <Badge tone="good">Valida</Badge> },
          ]} />
      )}
    </>
  );
}

export function SaleDetail({ params }) {
  const { can } = useApp();
  const { data: s, error, loading, reload } = useData(`/sales/${params.id}`);
  const look = useData("/lookups");
  const [voiding, setVoiding] = useState(false);
  const [refund, setRefund] = useState(false);
  const [run] = useAction();
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const refunded = s.refunds.filter((r) => r.status === "valida").reduce((t, r) => t - Number(r.gross_total), 0);
  return (
    <>
      <PageHeader back={{ to: "/vendite", label: "Vendite" }} title={`${s.kind === "rimborso" ? "Rimborso" : "Vendita"} n. ${s.number}`}
        sub={`${F.datetime(s.sold_at)} · ${s.channel_name} · registrata da ${s.user_name || "—"}`}
        actions={s.status === "valida" && <>
          {s.kind === "vendita" && can("sales.refund") && <Button onClick={() => setRefund(true)}>Rimborso</Button>}
          {can("sales.void") && <Button variant="danger" onClick={() => setVoiding(true)}>Annulla vendita</Button>}
        </>} />
      {s.status === "annullata" && <Notice tone="bad">Annullata il {F.datetime(s.voided_at)}: {s.void_reason}. Il magazzino è stato ripristinato.</Notice>}
      <div className="dash-grid" style={{ marginTop: 0 }}>
        <div className="stack">
          <div className="card">
            <table className="plain-table">
              <thead><tr><th>Prodotto</th><th className="r">Qtà</th><th className="r">Prezzo</th><th className="r">Sconto</th><th className="r">IVA</th><th className="r">Totale</th></tr></thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}</td><td className="r">{F.num(l.qty)}</td><td className="r">{F.eur(l.unit_price)}</td>
                    <td className="r">{F.eur(l.discount)}</td><td className="r">{F.num(l.vat_rate)}%</td><td className="r">{F.eur(l.line_total)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Totale IVA inclusa</td><td className="r"><b>{F.eur(s.gross_total)}</b></td></tr>
                <tr><td colSpan={5} className="muted">di cui imponibile / IVA</td><td className="r muted">{F.eur(s.net_total)} / {F.eur(s.vat_total)}</td></tr>
                {Number(s.commission_gross) !== 0 && <tr><td colSpan={5} className="muted">Commissione stimata del canale</td><td className="r muted">{F.eur(s.commission_gross)}</td></tr>}
                {s.cost_total !== undefined && <tr><td colSpan={5} className="muted">Costo teorico materie prime</td><td className="r muted">{F.eur(s.cost_total)}</td></tr>}
              </tfoot>
            </table>
            {s.notes && <p className="muted" style={{ marginTop: 10 }}>Note: {s.notes}</p>}
          </div>
          {s.movements?.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Scarico dal magazzino</h2></div>
              <table className="plain-table"><tbody>
                {s.movements.map((m) => <tr key={m.id}><td>{m.name}</td><td className="r">{F.num(m.qty)} {m.unit_code}</td>
                  <td className="muted">{m.type === "storno" ? "storno" : ""}</td>{m.value !== undefined && <td className="r">{F.eur(m.value)}</td>}</tr>)}
              </tbody></table>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Pagamenti</h2></div>
            <ul className="list-plain">
              {s.payments.map((p) => (
                <li key={p.id}><span>{p.method_name}<span className="muted small" style={{ display: "block" }}>
                  {p.status === "incassato" ? `incassato il ${F.date(p.received_at)}${p.account_name ? " su " + p.account_name : ""}` : p.status === "in_attesa" ? "da incassare" : "annullato"}</span></span>
                  <b className="tabular">{F.eur(p.amount)}</b></li>
              ))}
            </ul>
          </div>
          {s.refunds.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Rimborsi</h2></div>
              <ul className="list-plain">{s.refunds.map((r) => <li key={r.id}><a href={`#/vendite/${r.id}`}>n. {r.number} del {F.date(r.sold_at)}</a><span>{F.eur(r.gross_total)}</span></li>)}</ul>
            </div>
          )}
        </div>
      </div>
      {voiding && <ReasonModal title="Annulla vendita" confirmLabel="Annulla vendita"
        message="La vendita resterà nello storico come annullata; gli ingredienti scaricati torneranno in magazzino."
        onClose={() => setVoiding(false)} onConfirm={async (reason) => {
          const ok = await run(() => api.post(`/sales/${s.id}/void`, { reason }), "Vendita annullata");
          if (ok) reload();
          return ok;
        }} />}
      {refund && <RefundModal sale={s} max={Number(s.gross_total) - refunded} methods={(look.data?.["payment-methods"] || []).filter((m) => m.received_immediately)}
        onClose={() => setRefund(false)} onDone={reload} />}
    </>
  );
}

function RefundModal({ sale, max, methods, onClose, onDone }) {
  const [f, setF] = useState({ amount: F.toInput(max.toFixed(2)), method_id: methods[0]?.id || "", reason: "" });
  const [run, busy] = useAction();
  const submit = async () => {
    const ok = await run(() => api.post(`/sales/${sale.id}/refund`, { amount: F.parseNum(f.amount), method_id: Number(f.method_id), reason: f.reason }), "Rimborso registrato");
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title="Rimborso al cliente" onClose={onClose} size="sm" footer={<><Button onClick={onClose}>Annulla</Button>
      <Button variant="primary" busy={busy} onClick={submit} disabled={f.reason.trim().length < 3}>Registra rimborso</Button></>}>
      <div className="stack">
        <p className="muted small">Il rimborso riduce i ricavi e registra l'uscita di denaro. Il magazzino non cambia (il prodotto è già stato consumato).</p>
        <Field label="Importo restituito" hint={`Massimo ${F.eur(max)}`}><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="€" /></Field>
        <Field label="Restituito con"><Select value={f.method_id} onChange={(v) => setF({ ...f, method_id: v })} options={methods.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Motivo" required><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function DayClose({ query }) {
  const { can } = useApp();
  const [day, setDay] = useState(query.date || F.todayISO());
  const { data, error, loading, reload } = useData(`/days/${day}`);
  const hist = useData(can("sales.close_day") ? "/days" : null);
  const [counted, setCounted] = useState({});
  const [notes, setNotes] = useState("");
  const [adjust, setAdjust] = useState(true);
  const [run, busy] = useAction();
  const closure = data?.closure;
  const blind = !!data?.blind;
  const submit = async () => {
    const c = Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, F.parseNum(v)]).filter(([, v]) => v !== null && !Number.isNaN(v)));
    const ok = await run(() => api.post(`/days/${day}/close`, { counted: c, notes, adjust_cash: adjust }), "Giornata chiusa");
    if (ok) { reload(); hist.reload(); setCounted({}); }
  };
  const reopen = async () => {
    const ok = await run(() => api.del(`/days/${day}/close`), "Giornata riaperta");
    if (ok) { reload(); hist.reload(); }
  };
  return (
    <>
      <PageHeader back={can("sales.view") ? { to: "/vendite", label: "Vendite" } : null} title="Chiusura di cassa"
        sub={blind ? "Conta i contanti in cassa e controlla il totale del POS, poi scrivi gli importi." : "Confronta quanto risulta dalle vendite con quanto hai effettivamente in cassa e sul POS."}
        actions={<Input type="date" value={day} max={F.todayISO()} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ width: 170 }} />} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && blind ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="card-head"><h2>{F.date(day)}</h2>{closure ? <Badge tone="good">Chiusa</Badge> : <Badge tone="warn">Aperta</Badge>}</div>
          {closure ? <p>Chiusura registrata il {F.datetime(closure.closed_at)}. Il responsabile vedrà gli importi e le eventuali differenze.</p> : <>
            <div className="stack">
              {data.by_method.filter((m) => m.kind !== "piattaforma").map((m) => (
                <Field key={m.method_id} label={m.kind === "contanti" ? `${m.name}: contanti contati in cassa` : `${m.name}: totale dello scontrino di chiusura`}>
                  <NumInput value={counted[m.method_id] || ""} onChange={(v) => setCounted({ ...counted, [m.method_id]: v })} suffix="€" /></Field>))}
              <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. fondo cassa, spiegazioni" /></Field>
              <div className="row end"><Button variant="primary" busy={busy} onClick={submit}>Chiudi la giornata</Button></div>
            </div>
          </>}
        </div>
      ) : data && (
        <div className="dash-grid" style={{ marginTop: 0 }}>
          <div className="card">
            <div className="card-head"><h2>{F.date(day)}</h2>{closure ? <Badge tone="good">Chiusa</Badge> : <Badge tone="warn">Aperta</Badge>}</div>
            <div className="stats" style={{ marginBottom: 16 }}>
              <div className="stat"><span className="stat-label">Vendite</span><span className="stat-value">{data.totals.n_sales}</span></div>
              <div className="stat"><span className="stat-label">Totale venduto</span><span className="stat-value">{F.eur(data.totals.gross)}</span></div>
              <div className="stat"><span className="stat-label">Sconti</span><span className="stat-value">{F.eur(data.totals.discounts)}</span></div>
              <div className="stat"><span className="stat-label">Rimborsi</span><span className="stat-value">{F.eur(data.totals.refunds)}</span></div>
            </div>
            <table className="plain-table">
              <thead><tr><th>Metodo</th><th className="r">Atteso</th><th className="r">Da incassare</th><th className="r" style={{ width: 150 }}>{closure ? "Contato" : "Contato / verificato"}</th><th className="r">Differenza</th></tr></thead>
              <tbody>
                {data.by_method.filter((m) => Number(m.received) || Number(m.pending) || m.kind === "contanti").map((m) => {
                  const exp = Number(m.received);
                  const raw = closure ? closure.counted[m.method_id] : counted[m.method_id];
                  const cv = raw === undefined || raw === "" ? null : Number(closure ? raw : F.parseNum(raw));
                  const diff = cv === null || Number.isNaN(cv) ? null : cv - exp;
                  return (
                    <tr key={m.method_id}>
                      <td>{m.name}</td><td className="r">{F.eur(exp)}</td><td className="r muted">{Number(m.pending) ? F.eur(m.pending) : ""}</td>
                      <td className="r">{closure ? (cv === null ? "—" : F.eur(cv)) : m.kind === "piattaforma" ? <span className="muted small">accredito successivo</span> :
                        <NumInput value={counted[m.method_id] || ""} onChange={(v) => setCounted({ ...counted, [m.method_id]: v })} suffix="€" />}</td>
                      <td className={`r ${diff ? (diff < 0 ? "neg" : "pos") : ""}`}>{diff === null ? "" : F.eur(diff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {closure ? (
              <div style={{ marginTop: 14 }}>
                <p>Differenza complessiva: <b className={Number(closure.difference) ? "neg" : ""}>{F.eur(closure.difference)}</b>. Chiusa il {F.datetime(closure.closed_at)}.</p>
                {closure.notes && <p className="muted">Note: {closure.notes}</p>}
                {can("sales.void") && <Button size="sm" onClick={reopen} busy={busy}>Riapri la giornata</Button>}
              </div>
            ) : can("sales.close_day") && (
              <div className="stack" style={{ marginTop: 14 }}>
                <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. fondo cassa, ammanchi, spiegazioni" /></Field>
                <Check checked={adjust} onChange={setAdjust} label="Allinea il saldo di cassa contanti alla somma contata"
                  hint="Registra la differenza come rettifica della cassa, visibile negli incassi" />
                <div className="row end"><Button variant="primary" busy={busy} onClick={submit}>Chiudi la giornata</Button></div>
                <p className="small muted">Dopo la chiusura, solo i responsabili possono aggiungere o annullare vendite di questa giornata.</p>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Per canale</h2></div>
            <ul className="list-plain">{data.by_channel.map((c) => <li key={c.name}><span>{c.name} <span className="muted small">({c.n})</span></span><b className="tabular">{F.eur(c.gross)}</b></li>)}</ul>
            {hist.data?.length > 0 && <>
              <div className="card-head" style={{ marginTop: 18 }}><h2>Ultime chiusure</h2></div>
              <ul className="list-plain">{hist.data.slice(0, 10).map((h) => (
                <li key={h.business_date}><a href="#/chiusura" onClick={(e) => { e.preventDefault(); setDay(h.business_date); }}>{F.date(h.business_date)}</a>
                  <span className={Number(h.difference) ? "neg tabular" : "tabular"}>{F.eur(h.difference)}</span></li>))}</ul>
            </>}
          </div>
        </div>
      )}
    </>
  );
}
