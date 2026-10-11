import React, { useRef, useState } from "react";
import { LuPlus, LuPaperclip, LuUpload } from "react-icons/lu";
import { api } from "../api.js";
import * as F from "../fmt.js";
import { Badge, Button, Check, Combo, DataTable, ErrorBox, Field, Input, Loading, Modal, NumInput, PageHeader, Textarea, navigate, useAction, useApp, useData } from "../ui.jsx";

export function Suppliers() {
  const { can } = useApp();
  const [inactive, setInactive] = useState(false);
  const { data, error, loading, reload } = useData(`/suppliers?active=${inactive ? 0 : 1}`);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Fornitori" actions={can("suppliers.edit") && <Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Nuovo fornitore</Button>} />
      <div className="row" style={{ marginBottom: 12 }}><Check checked={inactive} onChange={setInactive} label="Includi non attivi" /><span className="spacer" />
        <Button size="sm" onClick={() => api.download("/export/suppliers.xlsx", "fornitori.xlsx")}>Excel</Button></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={data || []} onRowClick={(r) => navigate(`/fornitori/${r.id}`)} empty="Nessun fornitore" columns={[
          { key: "legal_name", label: "Ragione sociale", render: (r) => <><b style={{ fontWeight: 600 }}>{r.legal_name}</b>{r.trade_name && <span className="sub">{r.trade_name}</span>}</> },
          { key: "vat_number", label: "P. IVA" }, { key: "phone", label: "Telefono" }, { key: "email", label: "E-mail" },
          { key: "payment_terms", label: "Pagamento" }, { key: "n_items", label: "Articoli", type: "number" },
          { key: "open_balance", label: "Da pagare", type: "money" }]} />
      )}
      {creating && <SupplierModal onClose={() => setCreating(false)} onSaved={(r) => navigate(`/fornitori/${r.id}`)} />}
    </>
  );
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const [f, setF] = useState(() => supplier || { legal_name: "", trade_name: "", vat_number: "", tax_code: "", email: "", phone: "", contact_person: "",
    address: "", city: "", zip: "", province: "", lead_time_days: "", payment_terms: "", payment_days: "", notes: "", is_active: true });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    const b = { ...f, lead_time_days: f.lead_time_days === "" || f.lead_time_days === null ? null : Number(f.lead_time_days),
      payment_days: f.payment_days === "" || f.payment_days === null ? null : Number(f.payment_days) };
    for (const k of Object.keys(b)) if (b[k] === "") b[k] = null;
    b.legal_name = f.legal_name;
    const r = await run(() => (supplier ? api.put(`/suppliers/${supplier.id}`, b) : api.post("/suppliers", b)), supplier ? "Fornitore aggiornato" : "Fornitore creato");
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={supplier ? "Modifica fornitore" : "Nuovo fornitore"} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>Salva</Button></>}>
      <div className="grid g3">
        <Field label="Ragione sociale" required className="span2"><Input value={f.legal_name} onChange={set("legal_name")} autoFocus /></Field>
        <Field label="Nome commerciale"><Input value={f.trade_name || ""} onChange={set("trade_name")} /></Field>
        <Field label="Partita IVA"><Input value={f.vat_number || ""} onChange={set("vat_number")} /></Field>
        <Field label="Codice fiscale"><Input value={f.tax_code || ""} onChange={set("tax_code")} /></Field>
        <Field label="Referente"><Input value={f.contact_person || ""} onChange={set("contact_person")} /></Field>
        <Field label="Telefono"><Input type="tel" value={f.phone || ""} onChange={set("phone")} /></Field>
        <Field label="E-mail" className="span2"><Input type="email" value={f.email || ""} onChange={set("email")} /></Field>
        <Field label="Indirizzo" className="span2"><Input value={f.address || ""} onChange={set("address")} /></Field>
        <Field label="Città"><Input value={f.city || ""} onChange={set("city")} /></Field>
        <Field label="Condizioni di pagamento"><Input value={f.payment_terms || ""} onChange={set("payment_terms")} placeholder="Es. bonifico 30 gg d.f." /></Field>
        <Field label="Giorni per il pagamento" hint="Calcola la scadenza delle fatture"><Input type="number" min={0} value={f.payment_days ?? ""} onChange={set("payment_days")} /></Field>
        <Field label="Tempi di consegna (giorni)"><Input type="number" min={0} value={f.lead_time_days ?? ""} onChange={set("lead_time_days")} /></Field>
        <Field label="Note" className="span-all"><Textarea value={f.notes || ""} onChange={set("notes")} rows={2} /></Field>
        {supplier && <Check checked={f.is_active} onChange={set("is_active")} label="Attivo" />}
      </div>
    </Modal>
  );
}

export function SupplierDetail({ params }) {
  const { can } = useApp();
  const { data: s, error, loading, reload } = useData(`/suppliers/${params.id}`);
  const items = useData(can("inventory.view") ? "/items" : null);
  const [edit, setEdit] = useState(false);
  const [newItem, setNewItem] = useState({ item_id: "", unit_price: "", supplier_code: "" });
  const [run, busy] = useAction();
  const fileRef = useRef();
  if (loading && !s) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader back={{ to: "/fornitori", label: "Fornitori" }} title={s.legal_name} sub={[s.trade_name, s.vat_number && `P. IVA ${s.vat_number}`].filter(Boolean).join(" · ")}
        actions={<>
          {can("purchasing.edit") && <Button onClick={() => navigate(`/ordini/nuovo?supplier=${s.id}`)}>Nuovo ordine</Button>}
          {can("suppliers.edit") && <Button variant="primary" onClick={() => setEdit(true)}>Modifica</Button>}
        </>} />
      <div className="dash-grid" style={{ marginTop: 0 }}>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Prodotti forniti e prezzi</h2></div>
            {s.items.length === 0 ? <p className="muted">I prezzi si aggiornano automaticamente a ogni ricevimento di merce.</p> : (
              <table className="plain-table"><thead><tr><th>Articolo</th><th>Codice fornitore</th><th className="r">Prezzo netto</th><th className="r">Aggiornato</th>{can("suppliers.edit") && <th />}</tr></thead>
                <tbody>{s.items.map((i) => <tr key={i.item_id}><td><a href={`#/magazzino/${i.item_id}`}>{i.name}</a></td><td>{i.supplier_code}</td>
                  <td className="r">{i.unit_price !== null ? `${F.eur4(i.unit_price)}/${i.unit_code}` : ""}</td><td className="r">{F.date(i.last_price_at)}</td>
                  {can("suppliers.edit") && <td><Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api.del(`/suppliers/${s.id}/items/${i.item_id}`))) reload(); }}>Rimuovi</Button></td>}</tr>)}</tbody></table>
            )}
            {can("suppliers.edit") && items.data && (
              <div className="grid g4" style={{ marginTop: 12, alignItems: "end" }}>
                <Field label="Articolo" className="span2"><Combo options={items.data.map((i) => ({ value: i.id, label: i.name, sub: i.unit_code }))} value={newItem.item_id} onChange={(v) => setNewItem({ ...newItem, item_id: v })} /></Field>
                <Field label="Prezzo netto per unità"><NumInput value={newItem.unit_price} onChange={(v) => setNewItem({ ...newItem, unit_price: v })} suffix="€" /></Field>
                <Button busy={busy} disabled={!newItem.item_id} onClick={async () => {
                  if (await run(() => api.post(`/suppliers/${s.id}/items`, { item_id: newItem.item_id, unit_price: F.parseNum(newItem.unit_price), supplier_code: newItem.supplier_code || null }), "Articolo aggiunto")) {
                    setNewItem({ item_id: "", unit_price: "", supplier_code: "" }); reload(); } }}>Aggiungi</Button>
              </div>
            )}
          </div>
          {s.expenses && <div className="card"><div className="card-head"><h2>Documenti e pagamenti</h2></div>
            {s.expenses.length === 0 ? <p className="muted">Nessuna spesa registrata.</p> :
              <table className="plain-table"><tbody>{s.expenses.map((e) => <tr key={e.id}><td>{F.date(e.doc_date)}</td><td><a href={`#/spese/${e.id}`}>{e.description}</a></td>
                <td className="r">{F.eur(e.total_amount)}</td><td><Badge tone={e.status === "pagata" ? "good" : "warn"}>{F.STATUS_LABELS[e.status]}</Badge></td></tr>)}</tbody></table>}</div>}
        </div>
        <div className="stack">
          <div className="card"><dl className="kv">
            <dt>Referente</dt><dd>{s.contact_person || "—"}</dd>
            <dt>Telefono</dt><dd>{s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : "—"}</dd>
            <dt>E-mail</dt><dd>{s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : "—"}</dd>
            <dt>Indirizzo</dt><dd>{[s.address, s.zip, s.city, s.province].filter(Boolean).join(", ") || "—"}</dd>
            <dt>Pagamento</dt><dd>{s.payment_terms || "—"}{s.payment_days ? ` (${s.payment_days} gg)` : ""}</dd>
            <dt>Consegna</dt><dd>{s.lead_time_days ? `${s.lead_time_days} giorni` : "—"}</dd>
            {s.notes && <><dt>Note</dt><dd>{s.notes}</dd></>}
          </dl></div>
          <div className="card"><div className="card-head"><h2>Ordini</h2></div>
            {s.orders.length === 0 ? <p className="muted">Nessun ordine.</p> : <ul className="list-plain">{s.orders.map((o) => <li key={o.id}><a href={`#/ordini/${o.id}`}>{o.number}</a><span>{F.date(o.order_date)} · {o.status}</span></li>)}</ul>}</div>
          <div className="card"><div className="card-head"><h2>Documenti</h2>
            {can("suppliers.edit") && <><input ref={fileRef} type="file" hidden accept="application/pdf,image/*" onChange={async (ev) => {
              const fd = new FormData(); fd.append("file", ev.target.files[0]); if (await run(() => api.upload(`/attachments/supplier/${s.id}`, fd), "Documento allegato")) reload(); }} />
              <Button size="sm" icon={LuUpload} onClick={() => fileRef.current.click()}>Allega</Button></>}</div>
            {s.attachments.length === 0 ? <p className="muted">Listini, contratti, schede tecniche.</p> :
              <ul className="list-plain">{s.attachments.map((a) => <li key={a.id}><button className="btn btn-ghost btn-sm" onClick={() => api.openFile(`/attachments/${a.id}?inline=1`)}><LuPaperclip /> {a.filename}</button></li>)}</ul>}</div>
        </div>
      </div>
      {edit && <SupplierModal supplier={s} onClose={() => setEdit(false)} onSaved={reload} />}
    </>
  );
}
