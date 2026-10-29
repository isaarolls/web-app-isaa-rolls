import React, { useEffect, useRef, useState } from "react";
import { LuMapPin, LuRadio, LuPower, LuExternalLink, LuPhone, LuMail } from "react-icons/lu";
import { api } from "../api.js";
import * as F from "../fmt.js";
import { Badge, Button, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Textarea, useAction, useApp, useData } from "../ui.jsx";

const SITE_URL = "/";

function geoError(e) {
  if (!navigator.geolocation) return "Questo telefono o browser non permette di leggere la posizione.";
  if (e && e.code === 1) return "Hai negato la posizione. Su iPhone: Impostazioni → Privacy e sicurezza → Localizzazione → Safari (o Siti web di Safari) → «Mentre usi l'app», poi ricarica la pagina.";
  if (e && e.code === 3) return "Il GPS ci sta mettendo troppo: spostati all'aperto e riprova.";
  return "Non riesco a leggere la posizione: controlla che la localizzazione sia attiva e riprova.";
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(null);
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  });
}

function distance(a, b) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Pagina «Posizione bici»: apre/chiude la bici sul sito e invia la posizione. */
export function BikeLocation() {
  const { can, toast } = useApp();
  const { data: b, error, loading, reload } = useData("/bike");
  const [run, busy] = useAction();
  const [msg, setMsg] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [lastSent, setLastSent] = useState(null);
  const [geoErr, setGeoErr] = useState("");
  const watchId = useRef(null), lastPos = useRef(null), lastAt = useRef(0), wake = useRef(null);

  useEffect(() => { if (b && msg === null) setMsg(b.message || ""); }, [b]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 30000); return () => clearInterval(t); }, [reload]);
  useEffect(() => () => stopWatch(), []);

  const keepAwake = async () => {
    try { if ("wakeLock" in navigator) wake.current = await navigator.wakeLock.request("screen"); } catch { /* non supportato */ }
  };
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && watchId.current !== null) keepAwake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function stopWatch() {
    if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null; setSharing(false);
    try { wake.current && wake.current.release(); } catch { /* */ }
    wake.current = null;
  }

  function startWatch() {
    if (!navigator.geolocation || watchId.current !== null) return;
    keepAwake();
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(async (p) => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      const now = Date.now();
      const moved = lastPos.current ? distance(lastPos.current, pos) : Infinity;
      if (now - lastAt.current < 15000 && moved < 25) return;   // al massimo ogni 15 s, o subito se ci si sposta
      if (now - lastAt.current < 60000 && moved < 8) return;     // fermi: un aggiornamento al minuto basta
      lastPos.current = pos; lastAt.current = now;
      try {
        const r = await api.post("/bike", { action: "aggiorna", lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6), accuracy_m: p.coords.accuracy });
        if (r.ignored) { stopWatch(); reload(); return; }
        setLastSent(new Date()); setGeoErr("");
      } catch { /* rete assente: riprova al prossimo aggiornamento */ }
    }, (e) => setGeoErr(geoError(e)), { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }

  const open = async (mode) => {
    setGeoErr("");
    let p;
    try { p = await getPosition(); } catch (e) { setGeoErr(geoError(e)); return; }
    const r = await run(() => api.post("/bike", { action: mode, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6),
      accuracy_m: p.coords.accuracy, message: msg || null }), mode === "live" ? "Bici aperta: i clienti vedono la posizione in tempo reale" : "Bici aperta: posizione salvata");
    if (!r) return;
    lastPos.current = { lat: p.coords.latitude, lng: p.coords.longitude }; lastAt.current = Date.now(); setLastSent(new Date());
    if (mode === "live") startWatch(); else stopWatch();
    reload();
  };
  const close = async () => {
    stopWatch();
    const r = await run(() => api.post("/bike", { action: "chiudi", message: msg || null }), "Bici chiusa: la posizione non è più visibile");
    if (r) reload();
  };
  const saveMsg = async () => {
    const r = await run(() => api.post("/bike", { action: "messaggio", message: msg || null }), "Messaggio aggiornato sul sito");
    if (r) reload();
  };

  if (loading && !b) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const isOpen = b.is_open;
  const ageMin = b.updated_at ? Math.floor((b.age_s || 0) / 60) : null;
  const autoClosed = isOpen && ageMin !== null && ageMin >= b.auto_close_min;
  return (
    <>
      <PageHeader title="Posizione bici" sub="Apri e chiudi la bici sul sito: quando è aperta, i clienti vedono sulla mappa dove vi trovate."
        actions={<Button icon={LuExternalLink} onClick={() => window.open(SITE_URL, "_blank")}>Apri il sito</Button>} />
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>
            {isOpen && !autoClosed ? <Badge tone="good">APERTI</Badge> : <Badge tone="bad">CHIUSI</Badge>}{" "}
            {isOpen && !autoClosed && <span className="muted small">{b.mode === "live" ? "posizione in tempo reale" : "posizione fissa"}</span>}
          </span>
          {b.updated_at && <span className="muted small">aggiornata {F.datetime(b.updated_at)}{b.updated_by_name ? ` · ${b.updated_by_name}` : ""}</span>}
        </div>
        {autoClosed && <Notice tone="warn">La posizione non si aggiorna da più di {Math.round(b.auto_close_min / 60)} ore: sul sito risultate chiusi. Riaprite se siete in giro.</Notice>}
        {isOpen && b.lat && (
          <p className="small" style={{ marginTop: 0 }}>
            Punto inviato: <a href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`} target="_blank" rel="noopener">vedi sulla mappa</a>
            {b.accuracy_m ? ` · precisione circa ${b.accuracy_m} m` : ""}
          </p>
        )}
        <div className="stack" style={{ gap: 10 }}>
          <Button variant="primary" size="lg" icon={LuRadio} busy={busy} onClick={() => open("live")}>Apri: posizione in tempo reale</Button>
          <Button size="lg" icon={LuMapPin} busy={busy} onClick={() => open("fissa")}>Apri: siamo fermi qui</Button>
          <Button variant="danger" size="lg" icon={LuPower} busy={busy} onClick={close} disabled={!isOpen}>Chiudi (nascondi la posizione)</Button>
        </div>
        {sharing && (
          <Notice tone="info"><b>Stai inviando la posizione da questo telefono</b>{lastSent ? ` · ultimo invio alle ${lastSent.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}.
            Tieni questa pagina aperta con lo schermo acceso: se blocchi il telefono o cambi app, la posizione smette di aggiornarsi (sul sito resta l'ultimo punto).</Notice>
        )}
        {!sharing && isOpen && b.mode === "live" && !autoClosed && (
          <Notice tone="warn">La bici è aperta in tempo reale ma questo telefono non sta inviando la posizione.
            <div style={{ marginTop: 8 }}><Button size="sm" onClick={() => open("live")}>Invia da questo telefono</Button></div></Notice>
        )}
        {geoErr && <Notice tone="bad">{geoErr}</Notice>}
        <Field label="Messaggio per i clienti (facoltativo)" hint="Compare sul sito sopra la mappa, anche quando siete chiusi" className="span-all">
          <Input value={msg ?? ""} maxLength={200} onChange={(e) => setMsg(e.target.value)} placeholder="Es. Oggi a Mondello fino alle 21!" />
        </Field>
        <div className="row end"><Button size="sm" busy={busy} onClick={saveMsg}>Salva messaggio</Button></div>
        <p className="small muted">Consiglio: quando vi fermate in un posto usate «siamo fermi qui», così non serve tenere il telefono acceso.
          «In tempo reale» serve quando vi spostate con la bici.</p>
      </div>
      {can("settings.manage") && b.site && <SiteInfo initial={b.site} onSaved={reload} />}
      {can("settings.manage") && b.site && b.allergen_catalog && <Allergens initial={b.site} catalog={b.allergen_catalog} onSaved={reload} />}
    </>
  );
}

function SiteInfo({ initial, onSaved }) {
  const [f, setF] = useState(initial);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
      <div className="card-head"><h2>Dati del sito</h2></div>
      <p className="small muted" style={{ marginTop: 0 }}>Compaiono sul sito pubblico. Lascia vuoto quello che non vuoi mostrare.</p>
      <div className="grid g2">
        <Field label="Instagram" hint="Nome utente o link"><Input value={f.instagram} onChange={set("instagram")} placeholder="@isaarolls" /></Field>
        <Field label="TikTok" hint="Nome utente o link"><Input value={f.tiktok} onChange={set("tiktok")} placeholder="@isaarolls" /></Field>
        <Field label="Link del negozio su Glovo" hint="Nell'app Glovo apri Isaa Rolls → Condividi → Copia link" className="span-all"><Input value={f.glovo || ""} onChange={set("glovo")} placeholder="https://glovoapp.com/…" /></Field>
        <Field label="WhatsApp" hint="Numero per il pulsante «Scrivici»"><Input value={f.whatsapp} onChange={set("whatsapp")} placeholder="+39 333 1234567" inputMode="tel" /></Field>
        <Field label="Telefono"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
        <Field label="E-mail pubblica"><Input value={f.email} onChange={set("email")} type="email" /></Field>
        <Field label="E-mail per le richieste eventi" hint="Dove ricevere l'avviso di una nuova richiesta (serve l'invio e-mail configurato)"><Input value={f.notify_email} onChange={set("notify_email")} type="email" /></Field>
        <Field label="Link per le recensioni Google" hint="App Google Maps → la tua foto → Il tuo profilo dell'attività → Chiedi recensioni → Copia link" className="span-all"><Input value={f.review || ""} onChange={set("review")} placeholder="https://g.page/r/…" /></Field>
      </div>
      <h3 style={{ margin: "18px 0 4px" }}>Dati dell'attività</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Obbligatori per legge: compaiono in fondo a ogni pagina del sito e nell'informativa privacy.</p>
      <div className="grid g2">
        <Field label="Ragione sociale" hint="Es. «Mario Rossi» (ditta individuale) o «Isaa Rolls S.r.l.»"><Input value={f.legal_name || ""} onChange={set("legal_name")} /></Field>
        <Field label="Partita IVA" hint="11 cifre"><Input value={f.vat || ""} onChange={set("vat")} inputMode="numeric" placeholder="01234567890" /></Field>
        <Field label="Sede" hint="Via, numero, CAP e città" className="span-all"><Input value={f.address || ""} onChange={set("address")} placeholder="Via …, 90100 Palermo (PA)" /></Field>
      </div>
      <div className="row end"><Button variant="primary" busy={busy} onClick={async () => { const { allergens, ...rest } = f; const r = await run(() => api.put("/site-info", rest), "Dati del sito salvati"); if (r) { setF(r); onSaved(); } }}>Salva</Button></div>
    </div>
  );
}

function Allergens({ initial, catalog, onSaved }) {
  const [al, setAl] = useState(() => initial.allergens || {});
  const [open, setOpen] = useState(null);
  const [run, busy] = useAction();
  const name = Object.fromEntries(catalog.allergens.map((a) => [a.code, a.it]));
  const toggle = (item, code) => setAl((s) => {
    const cur = s[item] || [];
    return { ...s, [item]: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] };
  });
  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
      <div className="card-head"><h2>Allergeni</h2></div>
      <p className="small muted" style={{ marginTop: 0 }}>Tocca un prodotto e spunta gli allergeni che contiene. Sul sito compare la tabella, sotto il menu.
        Se non spunti niente, il sito dice di chiedere al personale.</p>
      <div style={{ display: "grid", gap: 8 }}>
        {catalog.items.map((it) => {
          const sel = al[it.code] || [];
          const isOpen = open === it.code;
          return (
            <div key={it.code} style={{ border: "1px solid var(--border, #ddd)", borderRadius: 12, padding: "10px 12px" }}>
              <button type="button" onClick={() => setOpen(isOpen ? null : it.code)}
                style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between", gap: 8 }}>
                <b>{it.it}</b>
                <span className="small muted" style={{ textAlign: "right" }}>{sel.length ? sel.map((c) => name[c]).join(", ") : "nessuno"} {isOpen ? "▲" : "▼"}</span>
              </button>
              {isOpen && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {catalog.allergens.map((a) => {
                    const on = sel.includes(a.code);
                    return (
                      <button key={a.code} type="button" onClick={() => toggle(it.code, a.code)}
                        style={{ padding: "8px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer",
                          border: "2px solid " + (on ? "#161616" : "#ccc"), background: on ? "#ffde00" : "transparent", color: "inherit" }}>
                        {on ? "✓ " : ""}{a.it}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="row end" style={{ marginTop: 12 }}>
        <Button variant="primary" busy={busy} onClick={async () => {
          const r = await run(() => api.put("/site-info", { allergens: al }), "Allergeni salvati");
          if (r) onSaved();
        }}>Salva allergeni</Button>
      </div>
    </div>
  );
}

const STATUS = { nuova: ["Nuova", "warn"], in_contatto: ["In contatto", "info"], preventivo: ["Preventivo inviato", "info"], confermato: ["Confermato", "good"], persa: ["Non confermato", "neutral"] };
const wa = (n) => "https://wa.me/" + String(n).replace(/[^\d]/g, "").replace(/^00/, "").replace(/^(?=3\d{8,9}$)/, "39");

/** Richieste arrivate dal modulo «Eventi e catering» del sito. */
export function EventRequests() {
  const { data, error, loading, reload } = useData("/event-requests");
  const [filter, setFilter] = useState("");
  const rows = (data || []).filter((r) => !filter || r.status === filter);
  const nNew = (data || []).filter((r) => r.status === "nuova").length;
  return (
    <>
      <PageHeader title="Richieste eventi" sub="Le richieste di preventivo per matrimoni, feste ed eventi arrivate dal sito."
        actions={<Button icon={LuExternalLink} onClick={() => window.open(SITE_URL + "eventi", "_blank")}>Vedi la pagina eventi</Button>} />
      <div className="row" style={{ marginBottom: 12 }}>
        <span style={{ width: 220 }}><Select value={filter} onChange={setFilter} placeholder="Tutte le richieste"
          options={Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))} /></span>
        {nNew > 0 && <Badge tone="warn">{nNew} da gestire</Badge>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : rows.length === 0 ? <p className="muted">Nessuna richiesta{filter ? " con questo stato" : ""}.</p> : (
        <div className="stack">{rows.map((r) => <EventCard key={r.id} r={r} onSaved={reload} />)}</div>
      )}
    </>
  );
}

function EventCard({ r, onSaved }) {
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes || "");
  const [run, busy] = useAction();
  const dirty = status !== r.status || notes !== (r.notes || "");
  const [label, tone] = STATUS[r.status] || [r.status, "neutral"];
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: 17 }}>{r.name} · {r.event_type}</b><Badge tone={tone}>{label}</Badge>
      </div>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>Ricevuta il {F.datetime(r.created_at)}</p>
      <div className="grid g2 small" style={{ gap: 6 }}>
        <span><b>Data evento:</b> {r.event_date ? F.date(r.event_date) : "da definire"}</span>
        <span><b>Ospiti:</b> {r.guests || "—"}</span>
        <span className="span-all"><b>Luogo:</b> {r.place}</span>
      </div>
      {r.message && <p style={{ whiteSpace: "pre-wrap" }}>{r.message}</p>}
      <div className="row" style={{ gap: 8, margin: "10px 0" }}>
        <a className="btn btn-sm" href={`tel:${r.phone.replace(/\s/g, "")}`}><LuPhone /> {r.phone}</a>
        <a className="btn btn-sm" href={wa(r.phone) + "?text=" + encodeURIComponent(`Ciao ${r.name}, siamo Isaa Rolls! Abbiamo ricevuto la tua richiesta per ${r.event_type.toLowerCase()}.`)} target="_blank" rel="noopener">WhatsApp</a>
        <a className="btn btn-sm" href={`mailto:${r.email}?subject=${encodeURIComponent("Isaa Rolls – il tuo evento")}`}><LuMail /> {r.email}</a>
      </div>
      <div className="grid g2">
        <Field label="Stato"><Select value={status} onChange={setStatus} options={Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))} /></Field>
        <Field label="Note interne" className="span-all"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. preventivo 450 € per 120 ospiti, richiamare lunedì" /></Field>
      </div>
      {dirty && <div className="row end"><Button variant="primary" busy={busy} onClick={async () => { const x = await run(() => api.put(`/event-requests/${r.id}`, { status, notes }), "Richiesta aggiornata"); if (x) onSaved(); }}>Salva</Button></div>}
    </div>
  );
}
