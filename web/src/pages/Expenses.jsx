import React, { useRef, useState } from "react";
import { LuPlus, LuPaperclip, LuUpload } from "react-icons/lu";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, Combo, DataTable, DateRange, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader, ReasonModal,
  Select, Tabs, Textarea, navigate, nums, useAction, useApp, useData, useRangeState,
} from "../ui.jsx";

const STATUS_TONE = { da_pagare: "warn", parziale: "info", pagata: "good" };
export const DOC_TYPES = [{ value: "fattura", label: "Fattura" }, { value: "ricevuta", label: "Ricevuta" }, { value: "scontrino", label: "Scontrino" },
  { value: "f24", label: "F24" }, { value: "busta_paga", label: "Busta paga" }, { value: "altro", label: "Altro" }];

export function Expenses({ query }) {
  const { can } = useApp();
  const [tab, setTab] = useState("spese");
  const [creating, setCreating] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <PageHeader title="Spese" sub="Fatture, ricevute e altre uscite, con scadenze e pagamenti."
        actions={can("expenses.edit") && <Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Nuova spesa</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "spese", label: "Spese" }, { value: "ricorrenti", label: "Spese ricorrenti" },
        can("reports.view") && { value: "componenti", label: "Altre componenti economiche" }]} />
      {tab === "spese" && <ExpenseList query={query} key={n} />}
      {tab === "ricorrenti" && <Recurring />}
      {tab === "componenti" && <Entries />}
      {creating && <ExpenseModal onClose={() => setCreating(false)} onSaved={(e) => { setN(n + 1); navigate(`/spese/${e.id}`); }} />}
    </>
  );
}

function ExpenseList({ query }) {
  const [from, to, setRange] = useRangeState("mese");
  const [status, setStatus] = useState(query.status || "");
  const [cat, setCat] = useState("");
  const [supplier, setSupplier] = useState("");
  const [dateField, setDateField] = useState("competence");
  const look = useData("/lookups");
  const sups = useData("/suppliers");
  const open = status === "aperte";
  const { data, error, loading, reload } = useData(`/expenses${qs({ from: open ? "" : from, to: open ? "" : to, status, category_id: cat, supplier_id: supplier,
    date_field: dateField === "doc" ? "doc" : dateField === "due" ? "due" : "", order: open ? "due" : "" })}`);
  const rows = data || [];
  const tot = rows.reduce((s, r) => s + Number(r.total_amount), 0);
  const res = rows.reduce((s, r) => s + Number(r.residual), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        {!open && <DateRange from={from} to={to} onChange={setRange} />}
        {!open && <span style={{ width: 170 }}><Select value={dateField} onChange={setDateField} options={[{ value: "competence", label: "per competenza" },
          { value: "doc", label: "per data documento" }, { value: "due", label: "per scadenza" }]} /></span>}
        <span style={{ width: 150 }}><Select value={status} onChange={setStatus} placeholder="Tutti gli stati" options={[{ value: "aperte", label: "Da saldare (tutte)" },
          { value: "da_pagare", label: "Da pagare" }, { value: "parziale", label: "Parziali" }, { value: "pagata", label: "Pagate" }]} /></span>
        <span style={{ width: 200 }}><Select value={cat} onChange={setCat} placeholder="Tutte le categorie" options={(look.data?.["expense-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></span>
        <span style={{ width: 200 }}><Select value={supplier} onChange={setSupplier} placeholder="Tutti i fornitori" options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name }))} /></span>
        <span className="spacer" />
        <span className="tabular">Totale <b>{F.eur(tot)}</b> · da pagare <b>{F.eur(res)}</b></span>
        <Button size="sm" onClick={() => api.download(`/export/expenses.xlsx${qs({ from, to })}`, "spese.xlsx")}>Excel</Button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={rows} onRowClick={(r) => navigate(`/spese/${r.id}`)} empty="Nessuna spesa nel periodo"
          rowClass={(r) => (r.overdue ? "bad" : "")}
          columns={[
            { key: "doc_date", label: "Data", type: "date" },
            { key: "description", label: "Descrizione", render: (r) => <><b style={{ fontWeight: 600 }}>{r.description}</b><span className="sub">{r.supplier_name || ""}{r.doc_number ? ` · n. ${r.doc_number}` : ""}{Number(r.n_attachments) ? " · 📎" : ""}</span></> },
            { key: "category_name", label: "Categoria", render: (r) => <>{r.category_name}{r.is_inventory && <span className="sub">magazzino</span>}</> },
            { key: "net_amount", label: "Imponibile", type: "money" },
            { key: "total_amount", label: "Totale", type: "money" },
            { key: "due_date", label: "Scadenza", render: (r) => <span className={r.overdue ? "neg" : ""}>{F.date(r.due_date)}</span>, sortValue: (r) => r.due_date },
            { key: "status", label: "Stato", render: (r) => <Badge tone={STATUS_TONE[r.status]}>{F.STATUS_LABELS[r.status]}</Badge> },
            { key: "residual", label: "Residuo", type: "money" },
          ]} />
      )}
    </>
  );
}

export function ExpenseModal({ expense, onClose, onSaved }) {
  const { can } = useApp();
  const look = useData("/lookups");
  const sups = useData("/suppliers");
  const [mode, setMode] = useState("net");
  const [f, setF] = useState(() => expense ? { ...expense, net_amount: F.toInput(expense.net_amount), vat_amount: F.toInput(expense.vat_amount),
    total_amount: F.toInput(expense.total_amount), vat_rate: "", supplier_id: expense.supplier_id || "", due_date: expense.due_date || "" } : {
    description: "", category_id: "", supplier_id: "", doc_type: "fattura", doc_number: "", doc_date: F.todayISO(), competence_date: "", net_amount: "",
    vat_rate: "22", vat_amount: "", total_amount: "", vat_deductible: true, due_date: "", notes: "", paid_now: false, payment_method_id: "", account_id: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const net = Number(F.parseNum(f.net_amount)) || 0, rate = Number(F.parseNum(f.vat_rate)) || 0, totIn = Number(F.parseNum(f.total_amount)) || 0;
  const calc = expense ? { net: Number(F.parseNum(f.net_amount)) || 0, vat: Number(F.parseNum(f.vat_amount)) || 0 } :
    mode === "net" ? { net, vat: Math.round(net * rate) / 100 } : { net: Math.round((totIn / (1 + rate / 100)) * 100) / 100, vat: 0 };
  if (!expense && mode === "total") calc.vat = Math.round((totIn - calc.net) * 100) / 100;
  const cat = (look.data?.["expense-categories"] || []).find((c) => String(c.id) === String(f.category_id));
  const submit = async () => {
    const b = { ...f, supplier_id: f.supplier_id || null, competence_date: f.competence_date || null, due_date: f.due_date || null,
      payment_method_id: f.payment_method_id || null, account_id: f.account_id || null, category_id: Number(f.category_id) };
    if (expense) Object.assign(b, { net_amount: F.parseNum(f.net_amount), vat_amount: F.parseNum(f.vat_amount), total_amount: null, vat_rate: null });
    else if (mode === "net") Object.assign(b, { net_amount: F.parseNum(f.net_amount), vat_rate: F.parseNum(f.vat_rate) || "0", vat_amount: null, total_amount: null });
    else Object.assign(b, { total_amount: F.parseNum(f.total_amount), vat_rate: F.parseNum(f.vat_rate) || "0", net_amount: null, vat_amount: null });
    const r = await run(() => (expense ? api.put(`/expenses/${expense.id}`, b) : api.post("/expenses", b)), expense ? "Spesa aggiornata" : "Spesa registrata");
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={expense ? "Modifica spesa" : "Nuova spesa"} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>{expense ? "Salva modifiche" : "Registra spesa"}</Button></>}>
      <div className="grid g3">
        <Field label="Descrizione" required className="span2"><Input value={f.description} onChange={set("description")} autoFocus /></Field>
        <Field label="Categoria" required><Select value={f.category_id} onChange={set("category_id")} placeholder="Scegli…" options={(look.data?.["expense-categories"] || []).filter((c) => c.is_active || String(c.id) === String(f.category_id)).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        {cat?.is_inventory && <div className="span-all"><Notice tone="warn">Per gli acquisti di merce che entra in magazzino usa «Ricevi merce» (menu Ordini o Magazzino): carica le quantità e crea la spesa in un solo passaggio, senza doppi conteggi. Se la registri solo qui, il costo entrerà nel conto economico quando la merce sarà caricata e consumata.</Notice></div>}
        <Field label="Fornitore" className="span2"><Combo options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name, sub: s.vat_number }))} value={f.supplier_id} onChange={set("supplier_id")} placeholder="Cerca fornitore (facoltativo)" /></Field>
        <Field label="Tipo documento"><Select value={f.doc_type} onChange={set("doc_type")} options={DOC_TYPES} /></Field>
        <Field label="Numero documento"><Input value={f.doc_number || ""} onChange={set("doc_number")} /></Field>
        <Field label="Data documento" required><Input type="date" value={f.doc_date} onChange={set("doc_date")} /></Field>
        <Field label="Mese di competenza" hint="Vuoto = data documento"><Input type="date" value={f.competence_date || ""} onChange={set("competence_date")} /></Field>
        {expense ? <>
          <Field label="Imponibile"><NumInput value={f.net_amount} onChange={set("net_amount")} suffix="€" /></Field>
          <Field label="IVA"><NumInput value={f.vat_amount} onChange={set("vat_amount")} suffix="€" /></Field>
          <Field label="Totale"><Input value={F.eur(calc.net + calc.vat)} readOnly /></Field>
        </> : <>
          <Field label="Inserisco l'importo"><Select value={mode} onChange={setMode} options={[{ value: "net", label: "Imponibile (senza IVA)" }, { value: "total", label: "Totale IVA inclusa" }]} /></Field>
          {mode === "net" ? <Field label="Imponibile" required><NumInput value={f.net_amount} onChange={set("net_amount")} suffix="€" /></Field>
            : <Field label="Totale IVA inclusa" required><NumInput value={f.total_amount} onChange={set("total_amount")} suffix="€" /></Field>}
          <Field label="Aliquota IVA" hint="0 se esente"><NumInput value={f.vat_rate} onChange={set("vat_rate")} suffix="%" /></Field>
          <div className="span-all muted small">Imponibile {F.eur(calc.net)} + IVA {F.eur(calc.vat)} = <b>{F.eur(calc.net + calc.vat)}</b></div>
        </>}
        <Field label="Scadenza del pagamento"><Input type="date" value={f.due_date || ""} onChange={set("due_date")} /></Field>
        <div className="span2" style={{ paddingTop: 24 }}><Check checked={f.vat_deductible} onChange={set("vat_deductible")} label="IVA detraibile" hint="Se no, l'IVA diventa un costo" /></div>
        <Field label="Note" className="span-all"><Textarea value={f.notes || ""} onChange={set("notes")} rows={2} /></Field>
        {!expense && can("expenses.pay") && <>
          <div className="span-all"><Check checked={f.paid_now} onChange={set("paid_now")} label="Già pagata per intero" /></div>
          {f.paid_now && <>
            <Field label="Pagata il"><Input type="date" value={f.paid_at || f.doc_date} onChange={set("paid_at")} /></Field>
            <Field label="Metodo"><Select value={f.payment_method_id} onChange={set("payment_method_id")} placeholder="—" options={(look.data?.["payment-methods"] || []).filter((m) => m.received_immediately).map((m) => ({ value: m.id, label: m.name }))} /></Field>
            <Field label="Conto"><Select value={f.account_id} onChange={set("account_id")} placeholder="Dal metodo" options={(look.data?.accounts || []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
          </>}
        </>}
      </div>
    </Modal>
  );
}

export function ExpenseDetail({ params }) {
  const { can } = useApp();
  const { data: e, error, loading, reload } = useData(`/expenses/${params.id}`);
  const look = useData("/lookups");
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [run, busy] = useAction();
  const fileRef = useRef();
  if (loading && !e) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const upload = async (file) => {
    const fd = new FormData(); fd.append("file", file);
    if (await run(() => api.upload(`/attachments/expense/${e.id}`, fd), "Documento allegato")) reload();
  };
  const voided = !!e.voided_at;
  return (
    <>
      <PageHeader back={{ to: "/spese", label: "Spese" }} title={e.description}
        sub={`${e.category_name}${e.supplier_name ? " · " + e.supplier_name : ""} · ${DOC_TYPES.find((d) => d.value === e.doc_type)?.label}${e.doc_number ? " n. " + e.doc_number : ""} del ${F.date(e.doc_date)}`}
        actions={!voided && <>
          {can("expenses.pay") && e.status !== "pagata" && <Button variant="primary" onClick={() => setPay(true)}>Registra pagamento</Button>}
          {can("expenses.edit") && <Button onClick={() => setEdit(true)}>Modifica</Button>}
          {can("expenses.void") && <Button variant="danger" onClick={() => setVoiding(true)}>Annulla spesa</Button>}
        </>} />
      {voided && <Notice tone="bad">Spesa annullata il {F.datetime(e.voided_at)}: {e.void_reason}</Notice>}
      {e.recurring_id && <Notice tone="info">Generata automaticamente da una spesa ricorrente: nessun pagamento è registrato finché non lo inserisci.</Notice>}
      <div className="stats">
        <div className="stat"><span className="stat-label">Imponibile</span><span className="stat-value">{F.eur(e.net_amount)}</span></div>
        <div className="stat"><span className="stat-label">IVA {e.vat_deductible ? "detraibile" : "indetraibile"}</span><span className="stat-value">{F.eur(e.vat_amount)}</span></div>
        <div className="stat"><span className="stat-label">Totale</span><span className="stat-value">{F.eur(e.total_amount)}</span></div>
        <div className={`stat ${e.overdue ? "stat-bad" : ""}`}><span className="stat-label">Da pagare</span><span className="stat-value">{F.eur(e.residual)}</span>
          <span className="stat-sub"><Badge tone={STATUS_TONE[e.status]}>{F.STATUS_LABELS[e.status]}</Badge> {e.due_date && `scadenza ${F.date(e.due_date)}`}</span></div>
      </div>
      <div className="dash-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Pagamenti</h2></div>
            {e.payments.length === 0 ? <p className="muted">Nessun pagamento registrato.</p> : (
              <ul className="list-plain">{e.payments.map((p) => (
                <li key={p.id} style={p.voided_at ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                  <span>{F.date(p.paid_at)} · {p.method_name || "—"} · {p.account_name}<span className="muted small" style={{ display: "block" }}>{p.user_name}{p.notes ? ` · ${p.notes}` : ""}</span></span>
                  <span className="row"><b className="tabular">{F.eur(p.amount)}</b>
                    {!p.voided_at && can("expenses.void") && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/expense-payments/${p.id}/void`), "Pagamento annullato")) reload(); }}>Annulla</Button>}</span>
                </li>))}</ul>
            )}
          </div>
          {e.receipt_lines?.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Merce caricata in magazzino</h2></div>
              <table className="plain-table"><tbody>{e.receipt_lines.map((l) => <tr key={l.id}><td>{l.name}</td><td className="r">{F.num(l.qty)} {l.unit_code}</td><td className="r">{F.eur4(l.unit_cost)}</td></tr>)}</tbody></table>
              <p className="muted small" style={{ marginTop: 8 }}>Il costo di questa spesa entra nel conto economico man mano che la merce viene consumata.</p>
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Documenti allegati</h2>
              {can("expenses.edit") && !voided && <><input ref={fileRef} type="file" accept="application/pdf,image/*" capture="environment" hidden onChange={(ev) => ev.target.files[0] && upload(ev.target.files[0])} />
                <Button size="sm" icon={LuUpload} busy={busy} onClick={() => fileRef.current.click()}>Allega</Button></>}</div>
            {e.attachments.length === 0 ? <p className="muted">Fotografa o carica la fattura (PDF o immagine, max 10 MB).</p> : (
              <ul className="list-plain">{e.attachments.map((a) => (
                <li key={a.id}><button className="btn btn-ghost btn-sm" onClick={() => api.openFile(`/attachments/${a.id}?inline=1`)}><LuPaperclip /> {a.filename}</button>
                  <span className="row"><span className="muted small">{Math.round(a.size_bytes / 1024)} KB</span>
                    {can("expenses.edit") && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.del(`/attachments/${a.id}`), "Allegato eliminato")) reload(); }}>Elimina</Button>}</span></li>))}</ul>
            )}
          </div>
          <div className="card"><dl className="kv">
            <dt>Competenza</dt><dd>{F.date(e.competence_date)}</dd>
            <dt>Gruppo</dt><dd>{F.PL_GROUPS[e.pl_group]}</dd>
            {e.notes && <><dt>Note</dt><dd>{e.notes}</dd></>}
            <dt>Registrata</dt><dd>{F.datetime(e.created_at)}</dd>
          </dl></div>
        </div>
      </div>
      {edit && <ExpenseModal expense={e} onClose={() => setEdit(false)} onSaved={reload} />}
      {pay && <PayModal expense={e} look={look.data} onClose={() => setPay(false)} onDone={reload} />}
      {voiding && <ReasonModal title="Annulla spesa" confirmLabel="Annulla spesa" message="La spesa resterà nello storico come annullata e non verrà più conteggiata."
        onClose={() => setVoiding(false)} onConfirm={async (reason) => { const ok = await run(() => api.post(`/expenses/${e.id}/void`, { reason }), "Spesa annullata"); if (ok) reload(); return ok; }} />}
    </>
  );
}

function PayModal({ expense, look, onClose, onDone }) {
  const [f, setF] = useState({ paid_at: F.todayISO(), amount: F.toInput(Number(expense.residual).toFixed(2)), method_id: "", account_id: "", notes: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  return (
    <Modal title="Registra pagamento" onClose={onClose} size="sm" footer={<><Button onClick={onClose}>Annulla</Button>
      <Button variant="primary" busy={busy} onClick={async () => { if (await run(() => api.post(`/expenses/${expense.id}/payments`, { ...f, amount: F.parseNum(f.amount),
        method_id: f.method_id || null, account_id: f.account_id || null }), "Pagamento registrato")) { onDone(); onClose(); } }}>Registra pagamento</Button></>}>
      <div className="stack">
        <Field label="Importo pagato" hint={`Residuo ${F.eur(expense.residual)}`}><NumInput value={f.amount} onChange={set("amount")} suffix="€" /></Field>
        <Field label="Data del pagamento"><Input type="date" value={f.paid_at} onChange={set("paid_at")} /></Field>
        <Field label="Metodo"><Select value={f.method_id} onChange={set("method_id")} placeholder="—" options={(look?.["payment-methods"] || []).filter((m) => m.received_immediately).map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Conto di uscita" hint="Vuoto = conto del metodo"><Select value={f.account_id} onChange={set("account_id")} placeholder="Automatico" options={(look?.accounts || []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Note"><Input value={f.notes} onChange={set("notes")} /></Field>
      </div>
    </Modal>
  );
}

function Recurring() {
  const { can } = useApp();
  const { data, reload } = useData("/recurring");
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, flex: 1 }}>Affitto, utenze, abbonamenti: ogni periodo viene creata automaticamente la spesa da pagare (mai come già pagata).</p>
        {can("expenses.edit") && <Button variant="primary" icon={LuPlus} onClick={() => setEdit({})}>Nuova ricorrenza</Button>}
      </div>
      <DataTable rows={data || []} empty="Nessuna spesa ricorrente" onRowClick={can("expenses.edit") ? setEdit : undefined} rowClass={(r) => (r.is_active ? "" : "voided")} columns={[
        { key: "description", label: "Descrizione", render: (r) => <><b style={{ fontWeight: 600 }}>{r.description}</b><span className="sub">{r.supplier_name || ""}</span></> },
        { key: "category_name", label: "Categoria" }, { key: "frequency", label: "Frequenza", render: (r) => `${r.frequency}, giorno ${r.day_of_month}` },
        { key: "net_amount", label: "Imponibile", type: "money" }, { key: "start_date", label: "Dal", type: "date" }, { key: "end_date", label: "Al", type: "date" },
        { key: "last_generated", label: "Ultima generazione", type: "date" }]} />
      {edit && <RecurringModal rec={edit.id ? edit : null} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  );
}

function RecurringModal({ rec, onClose, onDone }) {
  const look = useData("/lookups");
  const sups = useData("/suppliers");
  const [f, setF] = useState(() => rec ? { ...rec, net_amount: F.toInput(rec.net_amount), vat_rate: F.toInput(rec.vat_rate), supplier_id: rec.supplier_id || "", end_date: rec.end_date || "" } :
    { description: "", category_id: "", supplier_id: "", net_amount: "", vat_rate: "22", vat_deductible: true, frequency: "mensile", day_of_month: 1,
      start_date: F.monthStart(), end_date: "", due_days: 0, is_active: true, notes: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    const b = nums({ ...f, supplier_id: f.supplier_id || null, end_date: f.end_date || null, category_id: Number(f.category_id),
      day_of_month: Number(f.day_of_month), due_days: Number(f.due_days) }, ["net_amount", "vat_rate"]);
    const r = await run(() => (rec ? api.put(`/recurring/${rec.id}`, b) : api.post("/recurring", b)));
    if (r) { onDone(); onClose(); }
  };
  return (
    <Modal title={rec ? "Modifica spesa ricorrente" : "Nuova spesa ricorrente"} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>Salva</Button></>}>
      <div className="grid g3">
        <Field label="Descrizione" required className="span2"><Input value={f.description} onChange={set("description")} /></Field>
        <Field label="Categoria" required><Select value={f.category_id} onChange={set("category_id")} placeholder="Scegli…" options={(look.data?.["expense-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Fornitore" className="span2"><Combo options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name }))} value={f.supplier_id} onChange={set("supplier_id")} placeholder="Facoltativo" /></Field>
        <Field label="Frequenza"><Select value={f.frequency} onChange={set("frequency")} options={["mensile", "bimestrale", "trimestrale", "semestrale", "annuale"].map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Imponibile" required><NumInput value={f.net_amount} onChange={set("net_amount")} suffix="€" /></Field>
        <Field label="IVA"><NumInput value={f.vat_rate} onChange={set("vat_rate")} suffix="%" /></Field>
        <Field label="Giorno del mese" hint="1–28"><Input type="number" min={1} max={28} value={f.day_of_month} onChange={set("day_of_month")} /></Field>
        <Field label="Dal"><Input type="date" value={f.start_date} onChange={set("start_date")} /></Field>
        <Field label="Al" hint="Vuoto = senza fine"><Input type="date" value={f.end_date} onChange={set("end_date")} /></Field>
        <Field label="Scadenza dopo (giorni)"><Input type="number" min={0} value={f.due_days} onChange={set("due_days")} /></Field>
        <div className="span-all row"><Check checked={f.vat_deductible} onChange={set("vat_deductible")} label="IVA detraibile" />{rec && <Check checked={f.is_active} onChange={set("is_active")} label="Attiva" />}</div>
      </div>
    </Modal>
  );
}

function Entries() {
  const { can } = useApp();
  const { data, reload } = useData("/economic-entries");
  const [f, setF] = useState({ entry_date: F.todayISO(), pl_group: "altri_ricavi", amount: "", description: "" });
  const [run, busy] = useAction();
  return (
    <>
      <Notice tone="info">Voci da inserire a mano nel conto economico gestionale: altri ricavi (es. contributi), ammortamenti stimati, accantonamenti, imposte stimate. Non muovono la liquidità.</Notice>
      {can("expenses.edit") && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="grid g4">
            <Field label="Data"><Input type="date" value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></Field>
            <Field label="Gruppo"><Select value={f.pl_group} onChange={(v) => setF({ ...f, pl_group: v })} options={["altri_ricavi", "costi_variabili", "costi_fissi", "personale", "altri_operativi", "oneri_finanziari", "imposte", "altre_componenti"].map((g) => ({ value: g, label: F.PL_GROUPS[g] }))} /></Field>
            <Field label="Importo"><NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} suffix="€" /></Field>
            <Field label="Descrizione"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
          <div className="row end" style={{ marginTop: 10 }}><Button variant="primary" busy={busy} onClick={async () => {
            if (await run(() => api.post("/economic-entries", { ...f, amount: F.parseNum(f.amount) }), "Voce registrata")) { setF({ ...f, amount: "", description: "" }); reload(); } }}>Aggiungi voce</Button></div>
        </div>
      )}
      <DataTable rows={data || []} empty="Nessuna voce" columns={[
        { key: "entry_date", label: "Data", type: "date" }, { key: "pl_group", label: "Gruppo", render: (r) => F.PL_GROUPS[r.pl_group] },
        { key: "description", label: "Descrizione" }, { key: "amount", label: "Importo", type: "money" }, { key: "user_name", label: "Utente" },
        can("expenses.void") && { key: "a", label: "", sortable: false, render: (r) => <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.post(`/economic-entries/${r.id}/void`), "Voce annullata")) reload(); }}>Annulla</Button> },
      ].filter(Boolean)} />
    </>
  );
}
