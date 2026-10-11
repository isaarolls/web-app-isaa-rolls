import React, { useMemo, useState } from "react";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, DataTable, DateRange, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader, Select, Tabs,
  useAction, useApp, useData, useRangeState, navigate,
} from "../ui.jsx";

export function Payments({ query }) {
  const { can } = useApp();
  const [tab, setTab] = useState(query.tab || "crediti");
  return (
    <>
      <PageHeader title="Incassi" sub="Soldi effettivamente ricevuti, crediti ancora da incassare e saldi di cassa e banca." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "crediti", label: "Da incassare" }, { value: "ricevuti", label: "Incassi ricevuti" }, { value: "conti", label: "Cassa e conti" }]} />
      {tab === "crediti" && <Receivables canManage={can("payments.manage")} />}
      {tab === "ricevuti" && <Received />}
      {tab === "conti" && <Accounts canManage={can("payments.manage")} />}
    </>
  );
}

function Receivables({ canManage }) {
  const look = useData("/lookups");
  const [channel, setChannel] = useState("");
  const { data, error, loading, reload } = useData(`/receivables${qs({ channel_id: channel })}`);
  const [sel, setSel] = useState(new Set());
  const [settle, setSettle] = useState(false);
  const rows = data || [];
  const selected = rows.filter((r) => sel.has(r.id));
  const selTot = selected.reduce((s, r) => s + Number(r.amount), 0);
  const selComm = selected.reduce((s, r) => s + Number(r.commission_gross || 0), 0);
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <>
      <Notice tone="info">Le vendite pagate tramite piattaforme (Glovo, ecc.) restano qui finché non registri l'accredito sul conto: solo allora diventano liquidità.</Notice>
      <div className="row" style={{ marginBottom: 12 }}>
        <span style={{ width: 200 }}><Select value={channel} onChange={(v) => { setChannel(v); setSel(new Set()); }} placeholder="Tutti i canali"
          options={(look.data?.channels || []).map((c) => ({ value: c.id, label: c.name }))} /></span>
        <span className="spacer" />
        <span>Totale da incassare: <b className="tabular">{F.eur(total)}</b></span>
        {canManage && <Button variant="primary" disabled={!selected.length} onClick={() => setSettle(true)}>Registra accredito ({selected.length})</Button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={rows} empty="Nessun credito da incassare" search={rows.length > 10}
          toolbar={canManage && rows.length > 0 && <Button size="sm" onClick={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
            {sel.size === rows.length ? "Deseleziona tutti" : "Seleziona tutti"}</Button>}
          onRowClick={canManage ? (r) => toggle(r.id) : (r) => navigate(`/vendite/${r.sale_id}`)}
          columns={[
            canManage && { key: "sel", label: "", sortable: false, width: 40, render: (r) => <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label="Seleziona" /> },
            { key: "business_date", label: "Data", type: "date" },
            { key: "number", label: "Vendita", render: (r) => <a href={`#/vendite/${r.sale_id}`} onClick={(e) => e.stopPropagation()}>n. {r.number}</a> },
            { key: "channel_name", label: "Canale" },
            { key: "method_name", label: "Metodo" },
            { key: "commission_gross", label: "Commissione stimata", type: "money" },
            { key: "amount", label: "Importo lordo", type: "money" },
          ].filter(Boolean)} />
      )}
      {settle && <SettleModal rows={selected} total={selTot} commission={selComm} channel={channel} accounts={look.data?.accounts || []}
        onClose={() => setSettle(false)} onDone={() => { setSel(new Set()); reload(); }} />}
    </>
  );
}

function SettleModal({ rows, total, commission, channel, accounts, onClose, onDone }) {
  const bank = accounts.find((a) => a.kind === "banca") || accounts[0];
  const [f, setF] = useState({ amount: F.toInput((total - commission).toFixed(2)), received_at: F.todayISO(), account_id: bank?.id || "", notes: "" });
  const [run, busy] = useAction();
  const amt = Number(F.parseNum(f.amount)) || 0;
  const diff = total - amt;
  const submit = async () => {
    const ok = await run(() => api.post("/settlements", { payment_ids: rows.map((r) => r.id), received_at: f.received_at, account_id: Number(f.account_id),
      amount: F.parseNum(f.amount), channel_id: channel ? Number(channel) : rows[0]?.channel_id, notes: f.notes || null }), "Accredito registrato");
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title="Registra accredito" onClose={onClose} footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>Registra accredito</Button></>}>
      <div className="stack">
        <p>{rows.length} vendite per un totale lordo di <b>{F.eur(total)}</b> (commissioni stimate {F.eur(commission)}).</p>
        <div className="grid g2">
          <Field label="Importo accreditato" hint="Quanto è arrivato effettivamente sul conto"><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="€" /></Field>
          <Field label="Data dell'accredito"><Input type="date" value={f.received_at} onChange={(e) => setF({ ...f, received_at: e.target.value })} /></Field>
          <Field label="Conto"><Select value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Note"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Es. bonifico settimana 41" /></Field>
        </div>
        <Notice tone={Math.abs(diff - commission) < 0.01 ? "good" : "warn"}>
          Trattenuto dalla piattaforma: {F.eur(diff)}. Commissioni stimate: {F.eur(commission)}.
          {Math.abs(diff - commission) >= 0.01 && " La differenza può indicare commissioni diverse da quelle impostate nel canale o promozioni a carico tuo."}
        </Notice>
      </div>
    </Modal>
  );
}

function Received() {
  const [from, to, setRange] = useRangeState("mese");
  const { can } = useApp();
  const [run] = useAction();
  const [n, setN] = useState(0);
  const { data: d, error, loading } = useData(`/received${qs({ from, to })}`, [n]);
  const totDirect = (d?.direct || []).reduce((s, r) => s + Number(r.amount), 0);
  const totSettl = (d?.settlements || []).filter((s) => !s.voided_at).reduce((s, r) => s + Number(r.amount), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><DateRange from={from} to={to} onChange={setRange} /><span className="spacer" />
        <b className="tabular">Totale incassato: {F.eur(totDirect + totSettl)}</b></div>
      <ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && (
        <div className="stack">
          <div>
            <h2 style={{ marginBottom: 8 }}>Incassi diretti (contanti, carte, pagamenti elettronici)</h2>
            <DataTable rows={d.direct} search={false} empty="Nessun incasso" columns={[
              { key: "day", label: "Giorno", type: "date" }, { key: "method_name", label: "Metodo" }, { key: "account_name", label: "Conto" },
              { key: "n", label: "N. pagamenti", type: "number" }, { key: "amount", label: "Importo", type: "money" }]} />
          </div>
          <div>
            <h2 style={{ marginBottom: 8 }}>Accrediti delle piattaforme</h2>
            <DataTable rows={d.settlements} search={false} empty="Nessun accredito" rowClass={(r) => (r.voided_at ? "voided" : "")} columns={[
              { key: "received_at", label: "Data", type: "date" }, { key: "channel_name", label: "Canale" }, { key: "account_name", label: "Conto" },
              { key: "n", label: "Vendite", type: "number" }, { key: "gross_settled", label: "Lordo vendite", type: "money" },
              { key: "amount", label: "Accreditato", type: "money" },
              can("payments.manage") && { key: "act", label: "", sortable: false, render: (r) => !r.voided_at && (
                <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/settlements/${r.id}/void`), "Accredito annullato: i crediti tornano da incassare")) setN(n + 1); }}>Annulla</Button>) },
            ].filter(Boolean)} />
          </div>
        </div>
      )}
    </>
  );
}

function Accounts({ canManage }) {
  const bal = useData("/accounts/balances");
  const mov = useData("/cash-movements");
  const [adding, setAdding] = useState(false);
  const [run] = useAction();
  return (
    <>
      <div className="stats">
        {(bal.data || []).map((a) => <div className="stat" key={a.id}><span className="stat-label">{a.name}</span><span className={`stat-value ${Number(a.balance) < 0 ? "neg" : ""}`}>{F.eur(a.balance)}</span>
          <span className="stat-sub">saldo registrato a oggi</span></div>)}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Saldo = saldo iniziale (Impostazioni) + incassi − pagamenti delle spese ± movimenti manuali. Confrontalo periodicamente con l'estratto conto.</p>
      <div className="card-head" style={{ marginTop: 18 }}>
        <h2>Movimenti di cassa e banca</h2>
        {canManage && <Button variant="primary" onClick={() => setAdding(true)}>Nuovo movimento</Button>}
      </div>
      <DataTable rows={mov.data || []} rowClass={(r) => (r.voided_at ? "voided" : "")} empty="Nessun movimento manuale" columns={[
        { key: "moved_at", label: "Data", type: "date" }, { key: "account_name", label: "Conto" },
        { key: "kind", label: "Tipo", render: (r) => r.kind.charAt(0).toUpperCase() + r.kind.slice(1) },
        { key: "description", label: "Descrizione" }, { key: "amount", label: "Importo", type: "money" }, { key: "user_name", label: "Utente" },
        canManage && { key: "act", label: "", sortable: false, render: (r) => !r.voided_at && <Button size="sm" variant="ghost" onClick={async () => {
          if (await run(() => api.post(`/cash-movements/${r.id}/void`), "Movimento annullato")) { mov.reload(); bal.reload(); } }}>Annulla</Button> },
      ].filter(Boolean)} />
      {adding && <CashModal accounts={(bal.data || [])} onClose={() => setAdding(false)} onDone={() => { mov.reload(); bal.reload(); }} />}
    </>
  );
}

function CashModal({ accounts, onClose, onDone }) {
  const [f, setF] = useState({ kind: "giroconto", account_id: accounts[0]?.id || "", to_account_id: accounts[1]?.id || "", amount: "", moved_at: F.todayISO(),
    description: "", direction: "entrata" });
  const [run, busy] = useAction();
  const submit = async () => {
    const ok = await run(() => api.post("/cash-movements", { ...f, amount: F.parseNum(f.amount), account_id: Number(f.account_id),
      to_account_id: f.kind === "giroconto" ? Number(f.to_account_id) : null }), "Movimento registrato");
    if (ok) { onDone(); onClose(); }
  };
  const opts = accounts.map((a) => ({ value: a.id, label: a.name }));
  return (
    <Modal title="Movimento di cassa o banca" onClose={onClose} footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>Registra movimento</Button></>}>
      <div className="grid g2">
        <Field label="Tipo" className="span-all"><Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[
          { value: "giroconto", label: "Giroconto (es. versamento contanti in banca)" }, { value: "apporto", label: "Apporto del titolare" },
          { value: "prelievo", label: "Prelievo del titolare" }, { value: "finanziamento", label: "Finanziamento ricevuto / restituito" },
          { value: "rettifica", label: "Rettifica di saldo" }, { value: "altro", label: "Altro" }]} /></Field>
        <Field label={f.kind === "giroconto" ? "Dal conto" : "Conto"}><Select value={f.account_id} onChange={(v) => setF({ ...f, account_id: v })} options={opts} /></Field>
        {f.kind === "giroconto" ? <Field label="Al conto"><Select value={f.to_account_id} onChange={(v) => setF({ ...f, to_account_id: v })} options={opts} /></Field>
          : ["rettifica", "altro", "finanziamento"].includes(f.kind) ? <Field label="Direzione"><Select value={f.direction} onChange={(v) => setF({ ...f, direction: v })}
            options={[{ value: "entrata", label: "Entrata" }, { value: "uscita", label: "Uscita" }]} /></Field> : <span />}
        <Field label="Importo"><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="€" /></Field>
        <Field label="Data"><Input type="date" value={f.moved_at} onChange={(e) => setF({ ...f, moved_at: e.target.value })} /></Field>
        <Field label="Descrizione" className="span-all" required><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>Questi movimenti cambiano solo la liquidità, non il risultato economico.</p>
    </Modal>
  );
}
