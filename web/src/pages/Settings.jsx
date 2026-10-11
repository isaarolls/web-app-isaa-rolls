import React, { useEffect, useRef, useState } from "react";
import { LuPlus, LuUpload, LuDownload } from "react-icons/lu";
import { api } from "../api.js";
import * as F from "../fmt.js";
import { Badge, Button, Check, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader, Select, Tabs, useAction, useApp, useData } from "../ui.jsx";

export function Settings() {
  const { can } = useApp();
  const [tab, setTab] = useState(can("settings.manage") ? "generali" : "importa");
  return (
    <>
      <PageHeader title="Impostazioni" />
      <Tabs value={tab} onChange={setTab} tabs={[
        can("settings.manage") && { value: "generali", label: "Azienda e criteri" },
        can("settings.manage") && { value: "tabelle", label: "Tabelle di base" },
        can("import.run") && { value: "importa", label: "Importa" },
        { value: "esporta", label: "Esporta e backup" },
        can("periods.close") && { value: "mesi", label: "Mesi chiusi" },
      ]} />
      {tab === "generali" && <General />}
      {tab === "tabelle" && <Tables />}
      {tab === "importa" && <Import />}
      {tab === "esporta" && <Export />}
      {tab === "mesi" && <Periods />}
    </>
  );
}

function General() {
  const { reloadMe } = useApp();
  const { data, loading, reload } = useData("/settings");
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF({ ...data, company: { ...(data.company || {}) } }); }, [data]);
  if (loading || !f) return <Loading />;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const setC = (k) => (e) => setF((s) => ({ ...s, company: { ...s.company, [k]: e.target.value } }));
  const save = async () => {
    const b = { ...f, default_sale_vat_rate: Number(F.parseNum(String(f.default_sale_vat_rate))), default_target_margin_pct: Number(F.parseNum(String(f.default_target_margin_pct))),
      expiry_warning_days: Number(f.expiry_warning_days), due_warning_days: Number(f.due_warning_days) };
    if (await run(() => api.put("/settings", b), "Impostazioni salvate")) { reload(); reloadMe(); }
  };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="card">
        <div className="card-head"><h2>Azienda</h2></div>
        <div className="grid g2">
          <Field label="Nome mostrato nell'app e nei report"><Input value={f.company.name || ""} onChange={setC("name")} /></Field>
          <Field label="Ragione sociale"><Input value={f.company.legal_name || ""} onChange={setC("legal_name")} /></Field>
          <Field label="Partita IVA"><Input value={f.company.vat_number || ""} onChange={setC("vat_number")} /></Field>
          <Field label="Indirizzo"><Input value={f.company.address || ""} onChange={setC("address")} /></Field>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Criteri di calcolo</h2></div>
        <Notice tone="warn">Questi criteri cambiano i risultati economici: concordali con il commercialista. Le modifiche valgono anche per i periodi passati non chiusi.</Notice>
        <div className="grid g2">
          <Field label="Regime IVA"><Select value={f.vat_regime} onChange={set("vat_regime")} options={[{ value: "ordinario", label: "Ordinario (IVA separata dai costi)" }, { value: "forfettario", label: "Forfettario (IVA è un costo)" }]} /></Field>
          <Field label="Aliquota IVA predefinita sulle vendite"><NumInput value={F.toInput(f.default_sale_vat_rate)} onChange={set("default_sale_vat_rate")} suffix="%" /></Field>
          <Field label="Costo delle materie prime" hint="«Consumi»: costo quando la merce viene usata (consigliato, evita doppi conteggi). «Acquisti»: costo quando arriva la fattura.">
            <Select value={f.materials_cost_method} onChange={set("materials_cost_method")} options={[{ value: "consumi", label: "Sui consumi effettivi" }, { value: "acquisti", label: "Sugli acquisti registrati" }]} /></Field>
          <Field label="Commissioni delle piattaforme" hint="«Vendite»: stimate con la % del canale a ogni vendita. «Spese»: dalle fatture delle piattaforme registrate come spese.">
            <Select value={f.platform_commissions_from || "vendite"} onChange={set("platform_commissions_from")} options={[{ value: "vendite", label: "Stimate sulle vendite" }, { value: "spese", label: "Dalle fatture registrate" }]} /></Field>
          <Field label="Margine lordo obiettivo predefinito" hint="Per il prezzo di vendita consigliato"><NumInput value={F.toInput(f.default_target_margin_pct)} onChange={set("default_target_margin_pct")} suffix="%" /></Field>
          <Field label="Valorizzazione del magazzino"><Input value="Costo medio ponderato" readOnly /></Field>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Funzionamento</h2></div>
        <div className="grid g2">
          <Field label="Avviso scadenza lotti (giorni prima)"><Input type="number" min={0} value={f.expiry_warning_days} onChange={(e) => set("expiry_warning_days")(e.target.value)} /></Field>
          <Field label="Avviso pagamenti in scadenza (giorni prima)"><Input type="number" min={0} value={f.due_warning_days} onChange={(e) => set("due_warning_days")(e.target.value)} /></Field>
          <Check checked={f.allow_negative_stock} onChange={set("allow_negative_stock")} label="Consenti vendite anche con giacenza insufficiente" hint="Consigliato: la vendita non si blocca e la giacenza negativa viene segnalata" />
          <Check checked={f.lock_closed_days} onChange={set("lock_closed_days")} label="Blocca le giornate di cassa chiuse" hint="Solo i responsabili possono modificarle" />
        </div>
      </div>
      <div className="row end"><Button variant="primary" busy={busy} onClick={save}>Salva impostazioni</Button></div>
    </div>
  );
}

const TABLES = {
  "product-categories": { label: "Categorie prodotti", cols: [["name", "Nome", "text"], ["sort_order", "Ordine", "int"]] },
  "item-categories": { label: "Categorie magazzino", cols: [["name", "Nome", "text"]] },
  "expense-categories": { label: "Categorie di spesa", cols: [["name", "Nome", "text"], ["pl_group", "Gruppo nel conto economico", "group"], ["is_inventory", "Merce di magazzino", "bool"],
    ["is_platform_commission", "Commissioni piattaforme", "bool"], ["amortization_months", "Ammortamento (mesi)", "int?"], ["is_active", "Attiva", "bool"]] },
  channels: { label: "Canali di vendita", cols: [["name", "Nome", "text"], ["commission_pct", "Commissione %", "num"], ["commission_fixed", "Commissione fissa €", "num"],
    ["commission_vat_rate", "IVA sulla commissione %", "num"], ["default_payment_method_id", "Pagamento predefinito", "method"], ["is_active", "Attivo", "bool"], ["sort_order", "Ordine", "int"]] },
  "payment-methods": { label: "Metodi di pagamento", cols: [["name", "Nome", "text"], ["kind", "Tipo", "pmkind"], ["account_id", "Conto di accredito", "account"],
    ["received_immediately", "Incassato subito", "bool"], ["is_active", "Attivo", "bool"], ["sort_order", "Ordine", "int"]] },
  accounts: { label: "Conti (cassa e banca)", cols: [["name", "Nome", "text"], ["kind", "Tipo", "acckind"], ["opening_balance", "Saldo iniziale €", "num"], ["opening_date", "Alla data", "date"], ["is_active", "Attivo", "bool"]] },
  units: { label: "Unità di misura", cols: [["code", "Codice", "text"], ["name", "Nome", "text"], ["dimension", "Grandezza", "text"], ["factor", "Fattore", "num"]], pk: "code" },
};

function Tables() {
  const [t, setT] = useState("channels");
  const look = useData("/lookups");
  const [edit, setEdit] = useState(null);
  const spec = TABLES[t];
  const rows = look.data?.[t] || [];
  const methods = look.data?.["payment-methods"] || [];
  const accounts = look.data?.accounts || [];
  const show = (c, r) => {
    const v = r[c[0]];
    if (c[2] === "bool") return v ? "Sì" : "No";
    if (c[2] === "group") return F.PL_GROUPS[v];
    if (c[2] === "method") return methods.find((m) => m.id === v)?.name || "—";
    if (c[2] === "account") return accounts.find((a) => a.id === v)?.name || "—";
    if (c[2] === "num") return F.num(v);
    if (c[2] === "date") return F.date(v);
    return v ?? "";
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span style={{ width: 260 }}><Select value={t} onChange={setT} options={Object.entries(TABLES).map(([k, s]) => ({ value: k, label: s.label }))} /></span>
        <span className="spacer" /><Button variant="primary" icon={LuPlus} onClick={() => setEdit({})}>Aggiungi</Button>
      </div>
      {t === "units" && <Notice tone="info">Unità della stessa grandezza si convertono tra loro tramite il fattore (es. kg = 1000, g = 1). Puoi aggiungere unità personalizzate come «vaschetta» con una grandezza propria.</Notice>}
      {t === "expense-categories" && <Notice tone="info">«Merce di magazzino» indica gli acquisti che diventano costo solo quando la merce viene consumata. «Commissioni piattaforme» evita di contare due volte le commissioni già stimate sulle vendite.</Notice>}
      <DataTable rows={rows} onRowClick={setEdit} search={rows.length > 12} columns={spec.cols.map((c) => ({ key: c[0], label: c[1], render: (r) => show(c, r) }))} />
      {edit && <LookupModal kind={t} spec={spec} row={edit[spec.pk || "id"] !== undefined ? edit : null} methods={methods} accounts={accounts}
        onClose={() => setEdit(null)} onDone={look.reload} />}
    </>
  );
}

function LookupModal({ kind, spec, row, methods, accounts, onClose, onDone }) {
  const [f, setF] = useState(() => {
    const o = {};
    spec.cols.forEach(([k, , t]) => { o[k] = row ? (t === "num" ? F.toInput(row[k]) : row[k] ?? "") : t === "bool" ? (k === "is_active" || k === "received_immediately") : t === "group" ? "altri_operativi" : t === "pmkind" ? "altro" : t === "acckind" ? "banca" : t === "date" ? F.todayISO() : ""; });
    return o;
  });
  const [run, busy] = useAction();
  const save = async () => {
    const b = {};
    spec.cols.forEach(([k, , t]) => { b[k] = t === "num" ? F.parseNum(f[k]) ?? "0" : t === "int" ? Number(f[k] || 0) : f[k] === "" && t !== "text" ? null : f[k]; });
    const key = row ? row[spec.pk || "id"] : null;
    const r = await run(() => (row ? api.put(`/lookups/${kind}/${encodeURIComponent(key)}`, b) : api.post(`/lookups/${kind}`, b)), "Salvato");
    if (r) { onDone(); onClose(); }
  };
  const del = async () => { if (await run(() => api.del(`/lookups/${kind}/${encodeURIComponent(row[spec.pk || "id"])}`), "Eliminato")) { onDone(); onClose(); } };
  const input = ([k, label, t]) => {
    const set = (v) => setF((s) => ({ ...s, [k]: v }));
    if (t === "bool") return <Check key={k} checked={!!f[k]} onChange={set} label={label} />;
    let el;
    if (t === "group") el = <Select value={f[k]} onChange={set} options={["materie_prime", "costi_variabili", "costi_fissi", "personale", "altri_operativi", "investimenti", "oneri_finanziari", "imposte", "non_economica"].map((g) => ({ value: g, label: F.PL_GROUPS[g] }))} />;
    else if (t === "method") el = <Select value={f[k] ?? ""} onChange={(v) => set(v ? Number(v) : "")} placeholder="—" options={methods.map((m) => ({ value: m.id, label: m.name }))} />;
    else if (t === "account") el = <Select value={f[k] ?? ""} onChange={(v) => set(v ? Number(v) : "")} placeholder="—" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />;
    else if (t === "pmkind") el = <Select value={f[k]} onChange={set} options={[["contanti", "Contanti"], ["carta", "Carta"], ["elettronico", "Elettronico"], ["piattaforma", "Piattaforma"], ["altro", "Altro"]].map(([v, l]) => ({ value: v, label: l }))} />;
    else if (t === "acckind") el = <Select value={f[k]} onChange={set} options={[["cassa", "Cassa contanti"], ["banca", "Banca"], ["altro", "Altro"]].map(([v, l]) => ({ value: v, label: l }))} />;
    else if (t === "num") el = <NumInput value={f[k]} onChange={set} />;
    else if (t === "int" || t === "int?") el = <Input type="number" value={f[k] ?? ""} onChange={(e) => set(e.target.value)} />;
    else if (t === "date") el = <Input type="date" value={f[k] || ""} onChange={(e) => set(e.target.value)} />;
    else el = <Input value={f[k] ?? ""} onChange={(e) => set(e.target.value)} disabled={row && k === spec.pk} />;
    return <Field key={k} label={label}>{el}</Field>;
  };
  return (
    <Modal title={row ? `Modifica: ${row.name || row.code}` : `Nuovo: ${spec.label.toLowerCase()}`} onClose={onClose}
      footer={<>{row && <Button variant="danger" onClick={del}>Elimina</Button>}<span className="spacer" /><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={save}>Salva</Button></>}>
      <div className="grid g2">{spec.cols.map(input)}</div>
      {row && <p className="muted small" style={{ marginTop: 10 }}>Gli elementi già usati in registrazioni non si possono eliminare: disattivali.</p>}
    </Modal>
  );
}

const IMPORTS = {
  items: { label: "Articoli e giacenze iniziali", hint: "Codice, nome, unità di misura obbligatori. Giacenza e costo creano il carico iniziale." },
  products: { label: "Catalogo prodotti in vendita", hint: "Nome e prezzo IVA inclusa obbligatori." },
  expenses: { label: "Spese storiche", hint: "Data, descrizione, categoria e importo. «pagata = si» registra anche il pagamento." },
  sales: { label: "Dati di vendita", hint: "Totali giornalieri (data, canale, importo) oppure righe per prodotto (data, prodotto, quantità)." },
};

function Import() {
  const { can } = useApp();
  const [kind, setKind] = useState("items");
  const [file, setFile] = useState(null);
  const [prev, setPrev] = useState(null);
  const [skip, setSkip] = useState(false);
  const [unload, setUnload] = useState(false);
  const [run, busy] = useAction();
  const ref = useRef();
  const form = () => { const fd = new FormData(); fd.append("file", file); if (skip) fd.append("skip_errors", "1"); if (unload) fd.append("unload_stock", "1"); return fd; };
  const preview = async (f) => { setFile(f); setPrev(null); const fd = new FormData(); fd.append("file", f); const r = await run(() => api.upload(`/import/${kind}/preview`, fd)); if (r) setPrev(r); };
  const commit = async () => {
    const r = await run(() => api.upload(`/import/${kind}/commit`, form()));
    if (r) { setPrev(null); setFile(null); ref.current.value = ""; alertDone(r); }
  };
  const { toast } = useApp();
  const alertDone = (r) => toast(`Importate ${r.imported} righe${r.skipped_duplicates ? `, ${r.skipped_duplicates} duplicati saltati` : ""}${r.skipped_errors ? `, ${r.skipped_errors} righe con errori escluse` : ""}`, "ok");
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card">
        <div className="grid g3" style={{ alignItems: "end" }}>
          <Field label="Cosa vuoi importare"><Select value={kind} onChange={(v) => { setKind(v); setPrev(null); setFile(null); }} options={Object.entries(IMPORTS).map(([k, x]) => ({ value: k, label: x.label }))} /></Field>
          <Button icon={LuDownload} onClick={() => api.download(`/import/${kind}/template`, `modello-${kind}.xlsx`)}>Scarica il modello Excel</Button>
          <div><input ref={ref} type="file" accept=".csv,.xlsx" hidden onChange={(e) => e.target.files[0] && preview(e.target.files[0])} />
            <Button variant="primary" icon={LuUpload} busy={busy} onClick={() => ref.current.click()}>Scegli file CSV o Excel</Button></div>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>{IMPORTS[kind].hint} Prima dell'importazione il file viene verificato: nulla viene salvato finché non confermi.</p>
      </div>
      {prev && (
        <div className="card">
          <div className="card-head"><h2>Verifica di «{file?.name}»</h2>
            <div className="row"><Badge>{prev.summary.total} righe</Badge><Badge tone="good">{prev.summary.valid} da importare</Badge>
              {prev.summary.duplicates > 0 && <Badge tone="warn">{prev.summary.duplicates} già presenti</Badge>}{prev.summary.errors > 0 && <Badge tone="bad">{prev.summary.errors} con errori</Badge>}</div></div>
          <DataTable rows={prev.rows} search={false} rowClass={(r) => (r.errors.length ? "bad" : r.duplicate ? "warn" : "")} pageSize={50} columns={[
            { key: "row", label: "Riga", width: 60 },
            { key: "data", label: "Dati letti", render: (r) => Object.entries(r.data).filter(([, v]) => v !== null && v !== "" && v !== false).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(" · ") },
            { key: "esito", label: "Esito", render: (r) => r.errors.length ? <span className="neg">{r.errors.join("; ")}</span> : r.duplicate ? <span className="muted">già presente: verrà saltata</span> : <span className="pos">ok{r.warnings.length ? ` – ${r.warnings.join("; ")}` : ""}</span> }]} />
          <div className="stack" style={{ marginTop: 12 }}>
            {prev.summary.errors > 0 && <Check checked={skip} onChange={setSkip} label="Importa solo le righe corrette" hint="Altrimenti correggi il file e caricalo di nuovo" />}
            {kind === "sales" && <Check checked={unload} onChange={setUnload} label="Scarica gli ingredienti dal magazzino per le vendite per prodotto" hint="Lascia disattivato per vendite storiche già considerate nelle giacenze iniziali" />}
            <div className="row end"><Button variant="primary" busy={busy} disabled={!prev.summary.valid || (prev.summary.errors > 0 && !skip)} onClick={commit}>Importa {prev.summary.valid} righe</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Export() {
  const { can } = useApp();
  const [from, setFrom] = useState(F.todayISO().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(F.todayISO());
  const q = `?from=${from}&to=${to}`;
  const exp = [
    can("inventory.view") && ["items", "Articoli di magazzino e giacenze", false], can("inventory.view") && ["movements", "Movimenti di magazzino", true],
    can("sales.view") && ["sales", "Vendite", true], can("sales.view") && ["sale-lines", "Righe di vendita (prodotti)", true],
    can("expenses.view") && ["expenses", "Spese", true], can("suppliers.view") && ["suppliers", "Fornitori", false],
  ].filter(Boolean);
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="card">
        <div className="card-head"><h2>Esporta i dati</h2></div>
        <div className="row" style={{ marginBottom: 12 }}>
          <Field label="Dal"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Al"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <ul className="list-plain">{exp.map(([k, l, ranged]) => (
          <li key={k}><span>{l}{ranged && <span className="muted small"> · nel periodo scelto</span>}</span>
            <span className="row"><Button size="sm" onClick={() => api.download(`/export/${k}.xlsx${ranged ? q : ""}`, `${k}.xlsx`)}>Excel</Button>
              <Button size="sm" onClick={() => api.download(`/export/${k}.csv${ranged ? q : ""}`, `${k}.csv`)}>CSV</Button></span></li>))}</ul>
      </div>
      {can("export.run") && (
        <div className="card">
          <div className="card-head"><h2>Copia completa dei dati aziendali</h2></div>
          <p>Un file Excel con tutte le tabelle del gestionale (un foglio per tabella). Utile da conservare o consegnare al commercialista.</p>
          <Button variant="primary" icon={LuDownload} onClick={() => api.download("/export-all.xlsx", "isa-manager-dati.xlsx")}>Scarica tutti i dati</Button>
        </div>
      )}
      <div className="card">
        <div className="card-head"><h2>Backup automatici</h2></div>
        <p>Il database di produzione viene salvato automaticamente ogni giorno dal servizio di hosting, e una copia indipendente viene creata ogni notte dallo script di backup (vedi la guida di pubblicazione). Gli allegati sono salvati nel database, quindi sono inclusi nei backup.</p>
        <p className="muted small">Il ripristino si esegue dal pannello dell'hosting o con lo script <code>restore.sh</code>, seguendo la procedura descritta nella documentazione.</p>
      </div>
    </div>
  );
}

function Periods() {
  const { data } = useData("/periods");
  return (
    <>
      <Notice tone="info">Un mese chiuso non accetta nuove registrazioni o modifiche: si chiude e si riapre dalla pagina Report.</Notice>
      <DataTable rows={data || []} search={false} empty="Nessun mese chiuso" columns={[
        { key: "period", label: "Mese", render: (r) => F.monthLabel(r.period) }, { key: "closed_at", label: "Chiuso il", type: "datetime" }, { key: "closed_by_name", label: "Da" }]} />
    </>
  );
}
