import React, { useMemo, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import { Badge, Button, Check, ConfirmModal, DataTable, DateRange, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, useAction, useApp, useData, useRangeState } from "../ui.jsx";

export function Users() {
  const { can } = useApp();
  const [tab, setTab] = useState(can("users.manage") ? "utenti" : "registro");
  return (
    <>
      <PageHeader title="Utenti e permessi" sub="Ogni collaboratore ha le sue credenziali personali: niente account condivisi." />
      <Tabs value={tab} onChange={setTab} tabs={[can("users.manage") && { value: "utenti", label: "Utenti" }, can("users.manage") && { value: "ruoli", label: "Ruoli e permessi" },
        can("audit.view") && { value: "registro", label: "Registro attività" }]} />
      {tab === "utenti" && <UserList />}
      {tab === "ruoli" && <Roles />}
      {tab === "registro" && <Audit />}
    </>
  );
}

function groupPerms(catalog) {
  const g = {};
  (catalog || []).forEach((p) => { (g[p.module] = g[p.module] || []).push(p); });
  return g;
}

function UserList() {
  const { data, error, loading, reload } = useData("/users");
  const roles = useData("/roles");
  const [edit, setEdit] = useState(null);
  const [secret, setSecret] = useState(null);
  return (
    <>
      <div className="row end" style={{ marginBottom: 12 }}><Button variant="primary" icon={LuPlus} onClick={() => setEdit({})}>Nuovo utente</Button></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={data || []} onRowClick={setEdit} rowClass={(r) => (r.is_active ? "" : "voided")} columns={[
          { key: "full_name", label: "Nome", render: (r) => <><b style={{ fontWeight: 600 }}>{r.full_name}</b><span className="sub">{r.email}</span></> },
          { key: "role_name", label: "Ruolo", render: (r) => <>{r.role_name}{r.overrides.length > 0 && <> <Badge tone="info">+{r.overrides.length} eccezioni</Badge></>}</> },
          { key: "is_active", label: "Stato", render: (r) => r.anonymized_at ? <Badge>Anonimizzato</Badge> : r.is_active ? (r.must_change_password ? <Badge tone="warn">Primo accesso</Badge> : <Badge tone="good">Attivo</Badge>) : <Badge tone="bad">Disattivato</Badge> },
          { key: "last_login_at", label: "Ultimo accesso", type: "datetime" },
          { key: "active_sessions", label: "Sessioni attive", type: "number" }]} />
      )}
      {edit && <UserModal user={edit.id ? edit : null} roles={roles.data || []} onClose={() => setEdit(null)} onDone={(s) => { reload(); if (s) setSecret(s); }} />}
      {secret && (
        <Modal title="Credenziali da consegnare" onClose={() => setSecret(null)} size="sm" footer={<Button variant="primary" onClick={() => setSecret(null)}>Fatto</Button>}>
          <p>{secret.label}</p>
          <div className="code">{secret.value}</div>
          <p className="muted small" style={{ marginTop: 10 }}>{secret.hint}</p>
        </Modal>
      )}
    </>
  );
}

function UserModal({ user, roles, onClose, onDone }) {
  const { user: me } = useApp();
  const catalog = useData("/auth/permissions-catalog");
  const [f, setF] = useState(() => user ? { email: user.email, full_name: user.full_name, role_id: user.role_id, is_active: user.is_active,
    overrides: Object.fromEntries(user.overrides.map((o) => [o.permission, o.granted])) } : { email: "", full_name: "", role_id: roles.find((r) => r.code === "vendite")?.id || "", is_active: true, overrides: {} });
  const [run, busy] = useAction();
  const [confirm, setConfirm] = useState(null);
  const role = roles.find((r) => r.id === Number(f.role_id));
  const rolePerms = new Set(role?.permissions || []);
  const groups = groupPerms(catalog.data);
  const effective = (code) => (f.overrides[code] !== undefined ? f.overrides[code] : rolePerms.has(code));
  const toggle = (code, val) => setF((s) => {
    const o = { ...s.overrides };
    if (val === rolePerms.has(code)) delete o[code]; else o[code] = val;
    return { ...s, overrides: o };
  });
  const body = () => ({ email: f.email, full_name: f.full_name, role_id: Number(f.role_id), is_active: f.is_active,
    overrides: Object.entries(f.overrides).map(([permission, granted]) => ({ permission, granted })) });
  const submit = async () => {
    if (user) { if (await run(() => api.put(`/users/${user.id}`, body()), "Utente aggiornato")) { onDone(); onClose(); } }
    else {
      const r = await run(() => api.post("/users", body()), "Utente creato");
      if (r) { onDone({ label: `Password temporanea per ${f.email}:`, value: r.temporary_password, hint: "Consegnala di persona: al primo accesso verrà chiesto di cambiarla." }); onClose(); }
    }
  };
  return (
    <Modal title={user ? user.full_name : "Nuovo utente"} onClose={onClose} size="lg"
      footer={<>
        {user && user.id !== me.id && <>
          <Button onClick={async () => { const r = await run(() => api.post(`/users/${user.id}/reset-link`)); if (r) { onDone({ label: "Link per scegliere una nuova password (valido 2 ore):", value: r.link, hint: "Invialo al collaboratore: il link funziona una sola volta." }); onClose(); } }}>Link nuova password</Button>
          <Button onClick={async () => { await run(() => api.post(`/users/${user.id}/revoke-sessions`), "Dispositivi disconnessi"); }}>Disconnetti dai dispositivi</Button>
          <Button variant="ghost" onClick={() => setConfirm("gdpr")}>Dati personali (GDPR)</Button>
        </>}
        <span className="spacer" />
        <Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>{user ? "Salva" : "Crea utente"}</Button>
      </>}>
      <div className="grid g3">
        <Field label="Nome e cognome" required><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
        <Field label="E-mail (per l'accesso)" required><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Ruolo"><select className="input" value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value, overrides: {} })}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        {user && <div className="span-all"><Check checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Utente attivo" hint="Disattivandolo, l'accesso viene bloccato subito su tutti i dispositivi" /></div>}
      </div>
      {role && <p className="muted small" style={{ margin: "14px 0 8px" }}>{role.description}. Puoi aggiungere o togliere singoli permessi solo a questo utente:</p>}
      <div className="perm-grid">
        {Object.entries(groups).map(([mod, perms]) => (
          <div className="perm-group" key={mod}><h3>{mod}</h3>
            {perms.map((p) => <Check key={p.code} checked={effective(p.code)} onChange={(v) => toggle(p.code, v)}
              label={<>{p.label}{f.overrides[p.code] !== undefined && <> <Badge tone="info">eccezione</Badge></>}</>} />)}
          </div>))}
      </div>
      {confirm === "gdpr" && <GdprModal user={user} onClose={() => setConfirm(null)} onDone={() => { onDone(); onClose(); }} />}
    </Modal>
  );
}

function GdprModal({ user, onClose, onDone }) {
  const [run, busy] = useAction();
  const [sure, setSure] = useState(false);
  const exportData = async () => {
    const d = await run(() => api.get(`/users/${user.id}/personal-data`));
    if (d) {
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `dati-personali-utente-${user.id}.json`; a.click();
    }
  };
  return (
    <Modal title="Dati personali" onClose={onClose} size="sm" footer={<Button onClick={onClose}>Chiudi</Button>}>
      <div className="stack">
        <p>Esporta i dati personali conservati per questo utente (profilo, accessi, attività).</p>
        <Button onClick={exportData} busy={busy}>Scarica i dati (JSON)</Button>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
        <p>Cancellazione: nome ed e-mail vengono sostituiti da un codice anonimo e l'accesso viene disattivato. Le registrazioni aziendali restano (obbligo di conservazione).</p>
        <Check checked={sure} onChange={setSure} label="Ho capito che l'operazione non è reversibile" />
        <Button variant="danger" disabled={!sure} busy={busy} onClick={async () => { if (await run(() => api.post(`/users/${user.id}/anonymize`), "Dati personali anonimizzati")) onDone(); }}>Anonimizza l'utente</Button>
      </div>
    </Modal>
  );
}

function Roles() {
  const { data, reload } = useData("/roles");
  const catalog = useData("/auth/permissions-catalog");
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const groups = groupPerms(catalog.data);
  return (
    <>
      <div className="row end" style={{ marginBottom: 12 }}><Button icon={LuPlus} onClick={() => setEdit({ name: "", description: "", permissions: [] })}>Nuovo ruolo</Button></div>
      <DataTable rows={data || []} search={false} onRowClick={(r) => setEdit({ ...r })} columns={[
        { key: "name", label: "Ruolo", render: (r) => <><b style={{ fontWeight: 600 }}>{r.name}</b><span className="sub">{r.description}</span></> },
        { key: "permissions", label: "Permessi", render: (r) => `${r.permissions.length} su ${catalog.data?.length || "–"}` },
        { key: "users", label: "Utenti attivi", type: "number" }]} />
      {edit && (
        <Modal title={edit.id ? `Ruolo: ${edit.name}` : "Nuovo ruolo"} onClose={() => setEdit(null)} size="lg"
          footer={<><Button onClick={() => setEdit(null)}>Annulla</Button><Button variant="primary" busy={busy} onClick={async () => {
            const b = { name: edit.name, description: edit.description, permissions: edit.permissions };
            if (await run(() => (edit.id ? api.put(`/roles/${edit.id}`, b) : api.post("/roles", b)), "Ruolo salvato")) { setEdit(null); reload(); } }}>Salva ruolo</Button></>}>
          <div className="grid g2" style={{ marginBottom: 14 }}>
            <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Descrizione"><Input value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
          </div>
          <div className="perm-grid">{Object.entries(groups).map(([mod, perms]) => (
            <div className="perm-group" key={mod}><h3>{mod}</h3>{perms.map((p) => (
              <Check key={p.code} checked={edit.permissions.includes(p.code)} label={p.label}
                onChange={(v) => setEdit({ ...edit, permissions: v ? [...edit.permissions, p.code] : edit.permissions.filter((x) => x !== p.code) })} />))}</div>))}</div>
        </Modal>
      )}
    </>
  );
}

const ACTIONS = { create: "Creazione", update: "Modifica", void: "Annullamento", delete: "Eliminazione", login: "Accesso", import: "Importazione", export: "Esportazione", anonymize: "Anonimizzazione" };

function Audit() {
  const [from, to, setRange] = useRangeState("settimana");
  const [entity, setEntity] = useState("");
  const { data, loading } = useData(`/audit${qs({ from, to, entity, limit: 1000 })}`);
  const [show, setShow] = useState(null);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <DateRange from={from} to={to} onChange={setRange} />
        <span style={{ width: 200 }}><Select value={entity} onChange={setEntity} placeholder="Tutto" options={[["sale", "Vendite"], ["expense", "Spese"], ["stock_movement", "Movimenti"], ["item", "Articoli"],
          ["product", "Prodotti"], ["recipe", "Ricette"], ["user", "Utenti"], ["settings", "Impostazioni"], ["period", "Chiusure mesi"], ["day_closure", "Chiusure cassa"]].map(([v, l]) => ({ value: v, label: l }))} /></span>
      </div>
      {loading && !data ? <Loading /> : (
        <DataTable rows={data || []} onRowClick={(r) => (r.before || r.after) && setShow(r)} empty="Nessuna attività nel periodo" columns={[
          { key: "at", label: "Quando", type: "datetime" }, { key: "user_name", label: "Chi" },
          { key: "action", label: "Azione", render: (r) => <Badge tone={r.action === "void" || r.action === "delete" ? "bad" : r.action === "create" ? "good" : "neutral"}>{ACTIONS[r.action] || r.action}</Badge> },
          { key: "summary", label: "Descrizione" }, { key: "ip", label: "IP" }]} />
      )}
      {show && <Modal title="Dettaglio della modifica" onClose={() => setShow(null)} size="lg">
        <div className="grid g2">
          <div><h3>Prima</h3><pre className="code" style={{ whiteSpace: "pre-wrap" }}>{show.before ? JSON.stringify(show.before, null, 2) : "—"}</pre></div>
          <div><h3>Dopo</h3><pre className="code" style={{ whiteSpace: "pre-wrap" }}>{show.after ? JSON.stringify(show.after, null, 2) : "—"}</pre></div>
        </div></Modal>}
    </>
  );
}
