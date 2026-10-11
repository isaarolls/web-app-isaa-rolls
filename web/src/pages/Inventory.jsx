import React, { useMemo, useState } from "react";
import { LuPlus, LuArrowDownToLine, LuArrowUpFromLine, LuTrash2, LuClipboardCheck, LuFactory } from "react-icons/lu";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, Combo, DataTable, DateRange, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader,
  ReasonModal, Select, Tabs, Textarea, navigate, nums, useAction, useApp, useData, useRangeState,
} from "../ui.jsx";
import { RecipeEditor } from "./Products.jsx";

const MOVE_TYPES = {
  acquisto: { label: "Carico da acquisto", sign: 1, cost: true }, carico: { label: "Carico senza acquisto", sign: 1, cost: true },
  scarico: { label: "Scarico / consumo", sign: -1 }, spreco: { label: "Spreco, danneggiato o scaduto", sign: -1 },
  reso_fornitore: { label: "Reso al fornitore", sign: -1 },
};

export function compatibleUnits(units, code) {
  const u = units.find((x) => x.code === code);
  return u ? units.filter((x) => x.dimension === u.dimension) : units;
}

export function Inventory({ query }) {
  const { can } = useApp();
  const [tab, setTab] = useState(query.tab || "pronti");
  const [newItem, setNewItem] = useState(false);
  return (
    <>
      <PageHeader title="Magazzino" sub="Giacenze, movimenti e inventari. Ogni variazione resta nello storico con data, utente e motivo."
        actions={<>
          {can("purchasing.receive") && <Button onClick={() => navigate("/ricevimento")} icon={LuArrowDownToLine}>Ricevi merce</Button>}
          {can("inventory.edit") && <Button variant="primary" icon={LuPlus} onClick={() => setNewItem(true)}>Nuovo articolo</Button>}
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "pronti", label: "Pezzi pronti e ammanchi" }, { value: "articoli", label: "Articoli" }, { value: "movimenti", label: "Movimenti" }, { value: "inventari", label: "Inventari fisici" },
        { value: "produzioni", label: "Produzioni" }]} />
      {tab === "pronti" && <FinishedGoods />}
      {tab === "articoli" && <ItemsList belowMin={query.below_min === "1"} />}
      {tab === "movimenti" && <MovementsList />}
      {tab === "inventari" && <Counts />}
      {tab === "produzioni" && <Productions />}
      {newItem && <ItemModal onClose={() => setNewItem(false)} onSaved={(r) => navigate(`/magazzino/${r.id}`)} />}
    </>
  );
}

function ItemsList({ belowMin }) {
  const { can } = useApp();
  const [kind, setKind] = useState("");
  const [cat, setCat] = useState("");
  const [onlyLow, setOnlyLow] = useState(belowMin);
  const [inactive, setInactive] = useState(false);
  const look = useData("/lookups");
  const { data, error, loading, reload } = useData(`/items${qs({ kind, category_id: cat, below_min: onlyLow ? 1 : "", active: inactive ? "0" : "1" })}`);
  const costs = can("inventory.costs");
  const total = (data || []).reduce((s, r) => s + Number(r.stock_value || 0), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span style={{ width: 180 }}><Select value={kind} onChange={setKind} placeholder="Tutti i tipi" options={Object.entries(F.KIND_LABELS).map(([v, l]) => ({ value: v, label: l }))} /></span>
        <span style={{ width: 200 }}><Select value={cat} onChange={setCat} placeholder="Tutte le categorie" options={(look.data?.["item-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></span>
        <Check checked={onlyLow} onChange={setOnlyLow} label="Solo sotto scorta" />
        <Check checked={inactive} onChange={setInactive} label="Includi disattivati" />
        <span className="spacer" />
        {costs && <b className="tabular">Valore: {F.eur(total)}</b>}
        {can("export.run") || can("inventory.view") ? <>
          <Button size="sm" onClick={() => api.download("/export/items.xlsx", "articoli.xlsx")}>Excel</Button>
          <Button size="sm" onClick={() => api.download("/export/items.csv", "articoli.csv")}>CSV</Button></> : null}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={data || []} onRowClick={(r) => navigate(`/magazzino/${r.id}`)} empty="Nessun articolo: crea il primo o importa il catalogo da Impostazioni"
          rowClass={(r) => (Number(r.qty_on_hand) < 0 ? "bad" : r.below_min ? "warn" : "")}
          columns={[
            { key: "name", label: "Articolo", render: (r) => <><b style={{ fontWeight: 600 }}>{r.name}</b><span className="sub">{r.sku}{r.category_name ? ` · ${r.category_name}` : ""}</span></> },
            { key: "kind", label: "Tipo", render: (r) => F.KIND_LABELS[r.kind] },
            { key: "qty_on_hand", label: "Giacenza", align: "right", sortValue: (r) => Number(r.qty_on_hand),
              render: (r) => <span className={Number(r.qty_on_hand) < 0 ? "neg" : ""}>{F.num(r.qty_on_hand)} {r.unit_code}{r.below_min && <> <Badge tone="warn">sotto minimo</Badge></>}</span> },
            { key: "min_qty", label: "Minimo", align: "right", render: (r) => Number(r.min_qty) ? `${F.num(r.min_qty)} ${r.unit_code}` : "" },
            costs && { key: "avg_cost", label: "Costo medio", type: "money4", render: (r) => `${F.eur4(r.avg_cost)}/${r.unit_code}` },
            costs && { key: "stock_value", label: "Valore", type: "money" },
            { key: "next_expiry", label: "Scadenza", type: "date" },
            { key: "location", label: "Posizione" },
          ].filter(Boolean)} />
      )}
    </>
  );
}

function MovementsList() {
  const [from, to, setRange] = useRangeState("mese");
  const [type, setType] = useState("");
  const { can } = useApp();
  const { data, error, loading } = useData(`/movements${qs({ from, to, type, limit: 5000 })}`);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <DateRange from={from} to={to} onChange={setRange} />
        <span style={{ width: 220 }}><Select value={type} onChange={setType} placeholder="Tutti i tipi" options={[
          ...Object.entries({ giacenza_iniziale: "Giacenza iniziale", acquisto: "Acquisto", carico: "Carico", consumo_vendita: "Consumo da vendita",
            scarico: "Scarico", spreco: "Spreco", rettifica_inventario: "Rettifica inventario", produzione_carico: "Produzione (carico)",
            produzione_scarico: "Produzione (consumo)", reso_fornitore: "Reso a fornitore", storno: "Storno" }).map(([v, l]) => ({ value: v, label: l }))]} /></span>
        <span className="spacer" />
        <Button size="sm" onClick={() => api.download(`/export/movements.xlsx${qs({ from, to })}`, "movimenti.xlsx")}>Esporta Excel</Button>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <MovementsTable rows={data || []} showItem costs={can("inventory.costs")} />}
    </>
  );
}

export function MovementsTable({ rows, showItem, costs, onReverse }) {
  return (
    <DataTable rows={rows} empty="Nessun movimento" rowClass={(r) => (r.reversed ? "voided" : "")}
      onRowClick={showItem ? (r) => navigate(`/magazzino/${r.item_id}`) : undefined}
      columns={[
        { key: "at", label: "Data e ora", type: "datetime" },
        showItem && { key: "item_name", label: "Articolo" },
        { key: "type_label", label: "Tipo", render: (r) => <>{r.type_label}{r.waste_reason && <span className="sub">{r.waste_reason}</span>}</> },
        { key: "qty", label: "Quantità", align: "right", render: (r) => <span className={Number(r.qty) < 0 ? "neg" : "pos"}>{Number(r.qty) > 0 ? "+" : ""}{F.num(r.qty)} {r.unit_code}</span> },
        { key: "qty_after", label: "Giacenza dopo", align: "right", render: (r) => F.num(r.qty_after) },
        costs && { key: "unit_cost", label: "Costo unit.", type: "money4" },
        costs && { key: "value", label: "Valore", type: "money" },
        { key: "reason", label: "Causale", render: (r) => <>{r.reason}{r.ref_type === "sale" && <a className="sub" href={`#/vendite/${r.ref_id}`} onClick={(e) => e.stopPropagation()}>apri vendita</a>}
          {r.lot_code && <span className="sub">lotto {r.lot_code}</span>}</> },
        { key: "user_name", label: "Utente" },
        onReverse && { key: "act", label: "", sortable: false, render: (r) => !r.reversed && r.type !== "storno" && !["sale", "goods_receipt", "production", "inventory_count"].includes(r.ref_type) && (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onReverse(r); }}>Storna</Button>) },
      ].filter(Boolean)} />
  );
}

export function ItemModal({ item, onClose, onSaved }) {
  const { can } = useApp();
  const look = useData("/lookups");
  const sups = useData("/suppliers");
  const [f, setF] = useState(() => item ? { ...item, min_qty: F.toInput(item.min_qty), vat_rate: F.toInput(item.vat_rate) } : {
    sku: "", name: "", kind: "materia_prima", category_id: "", unit_code: "kg", min_qty: "", vat_rate: "10", location: "",
    default_supplier_id: "", track_lots: false, semi_mode: "esplodi", description: "", notes: "", is_active: true,
    initial_qty: "", initial_cost: "", initial_lot: "", initial_expiry: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    const body = nums({ ...f, category_id: f.category_id || null, default_supplier_id: f.default_supplier_id || null,
      initial_expiry: f.initial_expiry || null, initial_lot: f.initial_lot || null }, ["min_qty", "vat_rate", "initial_qty", "initial_cost"]);
    if (body.min_qty === null) body.min_qty = "0";
    if (body.vat_rate === null) body.vat_rate = "10";
    const r = await run(() => (item ? api.put(`/items/${item.id}`, body) : api.post("/items", body)), item ? "Articolo aggiornato" : "Articolo creato");
    if (r) { onSaved?.(r); onClose(); }
  };
  const units = look.data?.units || [];
  return (
    <Modal title={item ? "Modifica articolo" : "Nuovo articolo"} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>{item ? "Salva modifiche" : "Crea articolo"}</Button></>}>
      <div className="grid g3">
        <Field label="Nome" required className="span2"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Codice (SKU)" required><Input value={f.sku} onChange={set("sku")} /></Field>
        <Field label="Tipo"><Select value={f.kind} onChange={set("kind")} options={Object.entries(F.KIND_LABELS).map(([v, l]) => ({ value: v, label: l }))} /></Field>
        <Field label="Categoria"><Select value={f.category_id || ""} onChange={set("category_id")} placeholder="—" options={(look.data?.["item-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Unità di misura" hint={item ? "Non modificabile se ci sono movimenti" : "In cui conti la giacenza"}>
          <Select value={f.unit_code} onChange={set("unit_code")} options={units.map((u) => ({ value: u.code, label: `${u.name} (${u.code})` }))} />
        </Field>
        <Field label="Scorta minima"><NumInput value={f.min_qty} onChange={set("min_qty")} suffix={f.unit_code} /></Field>
        <Field label="IVA acquisto"><NumInput value={f.vat_rate} onChange={set("vat_rate")} suffix="%" /></Field>
        <Field label="Posizione"><Input value={f.location || ""} onChange={set("location")} placeholder="Es. frigo 2" /></Field>
        <Field label="Fornitore principale" className="span2"><Select value={f.default_supplier_id || ""} onChange={set("default_supplier_id")} placeholder="—"
          options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name }))} /></Field>
        <div className="stack" style={{ gap: 8, paddingTop: 22 }}>
          <Check checked={f.track_lots} onChange={set("track_lots")} label="Gestisci lotti e scadenze" />
          {item && <Check checked={f.is_active} onChange={set("is_active")} label="Attivo" />}
        </div>
        {f.kind === "semilavorato" && (
          <Field label="Uso nelle ricette" className="span-all" hint="Con «scomponi», vendendo un prodotto si scaricano direttamente gli ingredienti del semilavorato. Con «produzione» registri tu quando produci un lotto (es. impasto) e si scarica il semilavorato.">
            <Select value={f.semi_mode} onChange={set("semi_mode")} options={[{ value: "esplodi", label: "Scomponi negli ingredienti alla vendita" }, { value: "produzione", label: "Registro le produzioni" }]} />
          </Field>
        )}
        <Field label="Descrizione" className="span-all"><Textarea value={f.description || ""} onChange={set("description")} rows={2} /></Field>
        {!item && can("inventory.move") && <>
          <h3 className="span-all" style={{ marginTop: 6 }}>Giacenza iniziale (facoltativa)</h3>
          <Field label="Quantità"><NumInput value={f.initial_qty} onChange={set("initial_qty")} suffix={f.unit_code} /></Field>
          <Field label="Costo unitario netto"><NumInput value={f.initial_cost} onChange={set("initial_cost")} suffix={`€/${f.unit_code}`} /></Field>
          {f.track_lots ? <Field label="Scadenza"><Input type="date" value={f.initial_expiry} onChange={set("initial_expiry")} /></Field> : <span />}
        </>}
      </div>
    </Modal>
  );
}

export function MoveModal({ item, defaultType = "scarico", onClose, onDone }) {
  const look = useData("/lookups");
  const [f, setF] = useState({ type: defaultType, qty: "", qty_unit: item.unit_code, unit_cost: "", reason: "", waste_reason: "", at: "", lot_code: "", expiry_date: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const t = MOVE_TYPES[f.type];
  const units = compatibleUnits(look.data?.units || [], item.unit_code);
  const submit = async () => {
    const body = { item_id: item.id, type: f.type, qty: F.parseNum(f.qty), qty_unit: f.qty_unit, reason: f.reason,
      unit_cost: t.cost || f.type === "reso_fornitore" ? F.parseNum(f.unit_cost) : null, waste_reason: f.type === "spreco" ? f.waste_reason || null : null,
      at: f.at || null, lot_code: f.lot_code || null, expiry_date: f.expiry_date || null };
    const ok = await run(() => api.post("/movements", body), "Movimento registrato");
    if (ok) { onDone(); onClose(); }
  };
  return (
    <Modal title={`${item.name}: movimento`} onClose={onClose}
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>Registra movimento</Button></>}>
      <div className="grid g2">
        <Field label="Tipo di movimento" className="span-all"><Select value={f.type} onChange={set("type")} options={Object.entries(MOVE_TYPES).map(([v, x]) => ({ value: v, label: x.label }))} /></Field>
        <Field label="Quantità" required><NumInput value={f.qty} onChange={set("qty")} autoFocus /></Field>
        <Field label="Unità"><Select value={f.qty_unit} onChange={set("qty_unit")} options={units.map((u) => ({ value: u.code, label: u.name }))} /></Field>
        {(t.cost || f.type === "reso_fornitore") && (
          <Field label={`Costo unitario netto IVA (per ${f.qty_unit})`} hint={f.type === "reso_fornitore" ? "Vuoto = costo medio" : "Per il costo medio ponderato"} className="span-all">
            <NumInput value={f.unit_cost} onChange={set("unit_cost")} suffix="€" />
          </Field>
        )}
        {f.type === "spreco" && (
          <Field label="Motivo dello spreco" required className="span-all"><Select value={f.waste_reason} onChange={set("waste_reason")} placeholder="Scegli…"
            options={[{ value: "danneggiato", label: "Danneggiato" }, { value: "scaduto", label: "Scaduto" }, { value: "sprecato", label: "Sprecato in lavorazione" }, { value: "altro", label: "Altro" }]} /></Field>
        )}
        {item.track_lots && t.sign > 0 && <>
          <Field label="Lotto"><Input value={f.lot_code} onChange={set("lot_code")} /></Field>
          <Field label="Scadenza"><Input type="date" value={f.expiry_date} onChange={set("expiry_date")} /></Field>
        </>}
        <Field label="Causale" required className="span-all" hint="Es. «DDT 123», «uso laboratorio», «caduto a terra»"><Input value={f.reason} onChange={set("reason")} /></Field>
        <Field label="Data e ora" hint="Vuoto = adesso" className="span-all"><Input type="datetime-local" value={f.at} onChange={set("at")} max={F.nowLocalInput()} /></Field>
      </div>
      {f.type === "acquisto" && <Notice tone="info">Per registrare anche la fattura e il pagamento usa «Ricevi merce»: eviterai di inserire due volte lo stesso acquisto.</Notice>}
    </Modal>
  );
}

export function ItemDetail({ params }) {
  const { can } = useApp();
  const { data: it, error, loading, reload } = useData(`/items/${params.id}`);
  const moves = useData(`/movements${qs({ item_id: params.id, limit: 1000 })}`);
  const [edit, setEdit] = useState(false);
  const [move, setMove] = useState(null);
  const [reverse, setReverse] = useState(null);
  const [produce, setProduce] = useState(false);
  const [run] = useAction();
  if (loading && !it) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const refresh = () => { reload(); moves.reload(); };
  const costs = can("inventory.costs");
  return (
    <>
      <PageHeader back={{ to: "/magazzino", label: "Magazzino" }} title={it.name}
        sub={`${it.sku} · ${F.KIND_LABELS[it.kind]}${it.category_name ? " · " + it.category_name : ""}${it.is_active ? "" : " · disattivato"}`}
        actions={<>
          {can("inventory.move") && <>
            <Button icon={LuArrowDownToLine} onClick={() => setMove("carico")}>Carico</Button>
            <Button icon={LuArrowUpFromLine} onClick={() => setMove("scarico")}>Scarico</Button>
            <Button icon={LuTrash2} onClick={() => setMove("spreco")}>Spreco</Button>
          </>}
          {it.kind === "semilavorato" && it.semi_mode === "produzione" && can("production.create") && <Button icon={LuFactory} onClick={() => setProduce(true)}>Registra produzione</Button>}
          {can("inventory.edit") && <Button onClick={() => setEdit(true)}>Modifica</Button>}
        </>} />
      <div className="stats">
        <div className={`stat ${Number(it.qty_on_hand) < 0 ? "stat-bad" : ""}`}><span className="stat-label">Giacenza</span><span className="stat-value">{F.num(it.qty_on_hand)} {it.unit_code}</span>
          <span className="stat-sub">minimo {F.num(it.min_qty)} {it.unit_code}{it.below_min ? " · da riordinare" : ""}</span></div>
        {costs && <div className="stat"><span className="stat-label">Costo medio ponderato</span><span className="stat-value">{F.eur4(it.avg_cost)}</span><span className="stat-sub">per {it.unit_code}, netto IVA</span></div>}
        {costs && <div className="stat"><span className="stat-label">Valore giacenza</span><span className="stat-value">{F.eur(it.stock_value)}</span></div>}
        {costs && <div className="stat"><span className="stat-label">Ultimo acquisto</span><span className="stat-value">{it.last_purchase_price ? F.eur4(it.last_purchase_price) : "—"}</span>
          <span className="stat-sub">{it.last_purchase_date ? F.date(it.last_purchase_date) : "mai"}</span></div>}
      </div>
      {Number(it.qty_on_hand) < 0 && <Notice tone="bad" >Giacenza negativa: probabilmente manca un carico. Registra l'acquisto o fai un inventario fisico.</Notice>}
      <div className="dash-grid">
        <div className="stack">
          {it.kind === "semilavorato" && <SemiRecipe item={it} />}
          <div>
            <h2 style={{ marginBottom: 8 }}>Storico movimenti</h2>
            {moves.loading && !moves.data ? <Loading /> : <MovementsTable rows={moves.data || []} costs={costs} onReverse={can("inventory.reverse") ? setReverse : null} />}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <dl className="kv">
              <dt>Fornitore</dt><dd>{it.supplier_name || "—"}</dd>
              <dt>Posizione</dt><dd>{it.location || "—"}</dd>
              <dt>IVA acquisto</dt><dd>{F.num(it.vat_rate)}%</dd>
              <dt>Lotti</dt><dd>{it.track_lots ? "gestiti" : "no"}</dd>
              {it.description && <><dt>Descrizione</dt><dd>{it.description}</dd></>}
            </dl>
          </div>
          {it.lots?.length > 0 && <div className="card"><div className="card-head"><h2>Lotti in giacenza</h2></div>
            <ul className="list-plain">{it.lots.map((l) => <li key={l.id}><span>{l.lot_code || "senza codice"}</span><span>{F.num(l.qty_remaining)} {it.unit_code} · scad. {F.date(l.expiry_date) || "—"}</span></li>)}</ul></div>}
          {it.used_in?.length > 0 && <div className="card"><div className="card-head"><h2>Usato in</h2></div>
            <ul className="list-plain">{it.used_in.map((u, i) => <li key={i}><a href={u.product_id ? `#/prodotti/${u.product_id}` : `#/magazzino/${u.item_id}`}>{u.name}</a></li>)}</ul></div>}
          {it.suppliers?.length > 0 && costs && <div className="card"><div className="card-head"><h2>Prezzi fornitori</h2></div>
            <ul className="list-plain">{it.suppliers.map((s) => <li key={s.supplier_id}><a href={`#/fornitori/${s.supplier_id}`}>{s.legal_name}</a><span>{F.eur4(s.unit_price)} · {F.date(s.last_price_at)}</span></li>)}</ul></div>}
        </div>
      </div>
      {edit && <ItemModal item={it} onClose={() => setEdit(false)} onSaved={refresh} />}
      {move && <MoveModal item={it} defaultType={move} onClose={() => setMove(null)} onDone={refresh} />}
      {produce && <ProduceModal item={it} onClose={() => setProduce(false)} onDone={refresh} />}
      {reverse && <ReasonModal title="Storna movimento" confirmLabel="Storna"
        message={`Verrà registrato un movimento opposto (${F.num(-Number(reverse.qty))} ${it.unit_code}) alla stessa data. L'originale resta nello storico.`}
        onClose={() => setReverse(null)} onConfirm={async (reason) => {
          const ok = await run(() => api.post(`/movements/${reverse.id}/reverse`, { reason }), "Movimento stornato");
          if (ok) refresh();
          return ok;
        }} />}
    </>
  );
}

function SemiRecipe({ item }) {
  const { can } = useApp();
  const { data, reload } = useData(`/items/${item.id}/recipe`);
  const [editing, setEditing] = useState(false);
  if (!data) return null;
  const r = data.recipe;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ricetta del semilavorato</h2>
        {can("products.edit") && <Button size="sm" onClick={() => setEditing(!editing)}>{editing ? "Chiudi" : r ? "Modifica ricetta" : "Crea ricetta"}</Button>}
      </div>
      {editing ? (
        <RecipeEditor initial={r} yieldLabel={`Resa (${item.unit_code})`} unitHint={item.unit_code}
          onSave={async (body) => { await api.post(`/items/${item.id}/recipe`, body); setEditing(false); reload(); }} />
      ) : r ? (
        <>
          <p className="muted small">Versione {r.version_no} · resa {F.num(r.yield_qty)} {item.unit_code}{r.unit_cost !== undefined && ` · costo ${F.eur4(r.unit_cost)} per ${item.unit_code}`}</p>
          <table className="plain-table"><tbody>{r.lines.map((l) => <tr key={l.id}><td>{l.item_name}</td><td className="r">{F.num(l.qty)} {l.unit_code}</td>
            {l.line_cost !== undefined && <td className="r">{F.eur4(l.line_cost)}</td>}</tr>)}</tbody></table>
        </>
      ) : <p className="muted">Nessuna ricetta: senza ricetta questo semilavorato si scarica come un normale articolo.</p>}
    </div>
  );
}

function ProduceModal({ item, onClose, onDone }) {
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [run, busy] = useAction();
  return (
    <Modal title={`Produzione: ${item.name}`} onClose={onClose} size="sm" footer={<><Button onClick={onClose}>Annulla</Button>
      <Button variant="primary" busy={busy} onClick={async () => { if (await run(() => api.post("/productions", { item_id: item.id, qty: F.parseNum(qty), notes }), "Produzione registrata")) { onDone(); onClose(); } }}>Registra produzione</Button></>}>
      <div className="stack">
        <p className="muted small">Gli ingredienti vengono scaricati secondo la ricetta e il semilavorato viene caricato al loro costo effettivo.</p>
        <Field label="Quantità prodotta" required><NumInput value={qty} onChange={setQty} suffix={item.unit_code} autoFocus /></Field>
        <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Productions() {
  const { can } = useApp();
  const { data, reload } = useData("/productions");
  const [v, setV] = useState(null);
  const [run] = useAction();
  return (
    <>
      <DataTable rows={data || []} empty="Nessuna produzione registrata" rowClass={(r) => (r.voided_at ? "voided" : "")} columns={[
        { key: "produced_at", label: "Data", type: "datetime" }, { key: "item_name", label: "Semilavorato" },
        { key: "qty_produced", label: "Quantità", align: "right", render: (r) => `${F.num(r.qty_produced)} ${r.unit_code}` },
        can("inventory.costs") && { key: "total_cost", label: "Costo", type: "money" }, { key: "user_name", label: "Utente" },
        can("inventory.reverse") && { key: "a", label: "", sortable: false, render: (r) => !r.voided_at && <Button size="sm" variant="ghost" onClick={() => setV(r)}>Annulla</Button> },
      ].filter(Boolean)} />
      {v && <ReasonModal title="Annulla produzione" onClose={() => setV(null)} onConfirm={async (reason) => {
        const ok = await run(() => api.post(`/productions/${v.id}/void`, { reason }), "Produzione annullata"); if (ok) reload(); return ok; }} />}
    </>
  );
}

function Counts() {
  const { can } = useApp();
  const { data, reload } = useData("/counts");
  const look = useData("/lookups");
  const [creating, setCreating] = useState(false);
  const [cat, setCat] = useState("");
  const [run, busy] = useAction();
  const open = (data || []).find((c) => c.status === "bozza");
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, flex: 1 }}>Conta fisicamente la merce: alla conferma, le differenze vengono registrate come rettifiche con il loro valore.</p>
        {can("inventory.count") && !open && (creating ? <>
          <span style={{ width: 220 }}><Select value={cat} onChange={setCat} placeholder="Tutti gli articoli" options={(look.data?.["item-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></span>
          <Button variant="primary" busy={busy} onClick={async () => { const r = await run(() => api.post("/counts", { category_id: cat ? Number(cat) : null })); if (r) navigate(`/inventario/${r.id}`); }}>Inizia</Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>Annulla</Button>
        </> : <Button variant="primary" icon={LuClipboardCheck} onClick={() => setCreating(true)}>Nuovo inventario</Button>)}
        {open && <Button variant="primary" onClick={() => navigate(`/inventario/${open.id}`)}>Continua l'inventario in corso</Button>}
      </div>
      <DataTable rows={data || []} onRowClick={(r) => navigate(`/inventario/${r.id}`)} empty="Nessun inventario" columns={[
        { key: "count_date", label: "Data", type: "datetime" }, { key: "status", label: "Stato", render: (r) => <Badge tone={r.status === "confermato" ? "good" : r.status === "bozza" ? "warn" : "neutral"}>{r.status === "bozza" ? "In corso" : r.status === "confermato" ? "Confermato" : "Annullato"}</Badge> },
        { key: "n_counted", label: "Contati", align: "right", render: (r) => `${r.n_counted} / ${r.n_lines}` }, { key: "created_by_name", label: "Creato da" }, { key: "notes", label: "Note" }]} />
    </>
  );
}

export function CountPage({ params }) {
  const { can } = useApp();
  const { data, error, loading, reload } = useData(`/counts/${params.id}`);
  const [vals, setVals] = useState({});
  const [q, setQ] = useState("");
  const [run, busy] = useAction();
  const lines = data?.lines || [];
  const editable = data?.status === "bozza" && can("inventory.count");
  const valOf = (l) => (vals[l.item_id] !== undefined ? vals[l.item_id] : F.toInput(l.counted_qty));
  const shown = useMemo(() => lines.filter((l) => !q || (l.name + l.sku).toLowerCase().includes(q.toLowerCase())), [lines, q]);
  const save = async (msg = "Conteggi salvati") => {
    const body = { lines: Object.entries(vals).map(([item_id, v]) => ({ item_id: Number(item_id), counted_qty: v === "" ? null : F.parseNum(v) })) };
    const ok = await run(() => api.put(`/counts/${params.id}`, body), msg);
    if (ok) { setVals({}); reload(); }
    return ok;
  };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const counted = lines.filter((l) => valOf(l) !== "").length;
  return (
    <>
      <PageHeader back={{ to: "/magazzino?tab=inventari", label: "Inventari" }} title={`Inventario fisico #${data.id}`}
        sub={`${F.datetime(data.count_date)} · ${counted} di ${lines.length} articoli contati`}
        actions={editable && <>
          <Button busy={busy} onClick={() => save()}>Salva</Button>
          <Button variant="danger" onClick={async () => { if (await run(() => api.post(`/counts/${params.id}/cancel`), "Inventario annullato")) reload(); }}>Annulla inventario</Button>
          <Button variant="primary" busy={busy} onClick={async () => {
            if (Object.keys(vals).length && !(await save("Conteggi salvati"))) return;
            const r = await run(() => api.post(`/counts/${params.id}/confirm`));
            if (r) { reload(); }
          }}>Conferma e rettifica</Button>
        </>} />
      {editable && <Notice tone="info">Inserisci le quantità contate. Gli articoli lasciati vuoti non vengono modificati. La giacenza teorica viene ricalcolata al momento della conferma, quindi puoi continuare a vendere.</Notice>}
      <div className="table-block">
        <div className="table-tools"><div className="search"><input className="input" placeholder="Cerca articolo…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Articolo</th><th>Posizione</th><th className="r">Teorica</th><th className="r" style={{ width: 170 }}>Contata</th><th className="r">Differenza</th></tr></thead>
            <tbody>
              {shown.map((l) => {
                const theo = data.status === "confermato" ? Number(l.expected_qty) : Number(l.qty_on_hand);
                const v = valOf(l);
                const c = v === "" ? null : Number(F.parseNum(v));
                const diff = data.status === "confermato" ? (l.difference !== null ? Number(l.difference) : null) : c === null || Number.isNaN(c) ? null : c - theo;
                return (
                  <tr key={l.id}>
                    <td><b style={{ fontWeight: 600 }}>{l.name}</b><span className="sub">{l.sku}{l.category_name ? ` · ${l.category_name}` : ""}</span></td>
                    <td>{l.location}</td>
                    <td className="r num-cell">{F.num(theo)} {l.unit_code}</td>
                    <td className="r">{editable ? <NumInput value={v} onChange={(x) => setVals({ ...vals, [l.item_id]: x })} suffix={l.unit_code} /> : c === null ? "—" : `${F.num(c)} ${l.unit_code}`}</td>
                    <td className={`r num-cell ${diff ? (diff < 0 ? "neg" : "pos") : ""}`}>{diff === null ? "" : `${diff > 0 ? "+" : ""}${F.num(diff)}`}{diff && l.avg_cost !== undefined ? <span className="sub">{F.eur(diff * Number(l.avg_cost))}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


/** Prodotti pronti contati a magazzino: produzione del giorno, conta di fine giornata e controllo ammanchi. */
function FinishedGoods() {
  const { can, toast } = useApp();
  const { data, error, loading, reload } = useData("/finished-goods");
  const [from, to, setRange] = useRangeState("mese");
  const rep = useData(`/reports/shrinkage${qs({ from, to })}`);
  const gifts = useData(`/giveaways${qs({ from, to })}`);
  const [voiding, setVoiding] = useState(null);
  const [qty, setQty] = useState({});
  const [run, busy] = useAction();
  const costs = can("inventory.costs");
  const rows = data || [];
  const reloadAll = () => { reload(); rep.reload(); gifts.reload(); };
  const linkAll = async () => {
    const r = await run(() => api.post("/products/track-stock-all"));
    if (r) { toast(`${r.linked} prodotti collegati al magazzino`, "ok"); reloadAll(); }
  };
  const produce = async () => {
    const lines = rows.map((r) => ({ item_id: r.id, qty: F.parseNum(qty[r.id]) })).filter((l) => Number(l.qty) > 0);
    if (!lines.length) { toast("Scrivi quanti pezzi hai preparato", "error"); return; }
    const r = await run(() => api.post("/productions/batch", { lines }), "Produzione registrata");
    if (r) { setQty({}); reloadAll(); }
  };
  const startCount = async () => {
    const r = await run(() => api.post("/counts", { item_ids: rows.map((x) => x.id), notes: "Conta di fine giornata dei pezzi pronti" }));
    if (r) navigate(`/inventario/${r.id}`);
  };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!rows.length) return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>I prodotti in vendita non sono ancora contati a magazzino</h2>
      <p className="muted" style={{ margin: 0 }}>Collegandoli, ogni roll, ciambella o bibita diventa un articolo «pezzo pronto»: la produzione aggiunge pezzi,
        ogni vendita in cassa ne toglie uno e la conta di fine giornata mostra se ne mancano.</p>
      {can("products.edit") ? <div><Button variant="primary" busy={busy} onClick={linkAll}>Collega tutti i prodotti al magazzino</Button></div>
        : <Notice tone="warn">Chiedi a un responsabile di collegare i prodotti dalla pagina Prodotti.</Notice>}
    </div>
  );
  const items = rep.data?.items || [];
  const totMissing = items.reduce((s, r) => s + Number(r.missing_qty || 0), 0);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h2>Oggi</h2>
          <span className="row" style={{ gap: 8 }}>
            {can("products.edit") && <Button size="sm" variant="ghost" busy={busy} onClick={linkAll}>Collega i prodotti nuovi</Button>}
            {can("inventory.count") && <Button size="sm" icon={LuClipboardCheck} busy={busy} onClick={startCount}>Conta di fine giornata</Button>}
          </span></div>
        <p className="muted small" style={{ marginTop: 0 }}>1) La mattina scrivi quanti pezzi hai preparato e premi «Registra produzione» (gli ingredienti escono dal magazzino).
          2) Le vendite in cassa tolgono i pezzi da sole. 3) A fine giornata premi «Conta di fine giornata» e scrivi quanti pezzi sono rimasti davvero.</p>
        <table className="plain-table">
          <thead><tr><th>Prodotto</th><th className="r">Ci sono</th>{can("production.create") && <th className="r" style={{ width: 92 }}>Preparati ora</th>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><a href={`#/magazzino/${r.id}`}>{r.name}</a>{r.kind === "semilavorato" && !r.has_recipe && <> <Badge tone="warn">senza ricetta</Badge></>}
                <span className="sub">oggi: preparati {F.num(r.made_today)} · venduti {F.num(r.sold_today)}</span></td>
              <td className={`r ${Number(r.qty_on_hand) < 0 ? "neg" : ""}`} style={{ whiteSpace: "nowrap" }}><b>{F.num(r.qty_on_hand)}</b> {r.unit_code}</td>
              {can("production.create") && <td className="r"><NumInput value={qty[r.id] || ""} onChange={(v) => setQty((s) => ({ ...s, [r.id]: v }))} placeholder="0" /></td>}
            </tr>))}</tbody>
        </table>
        {rows.some((r) => Number(r.qty_on_hand) < 0) && <Notice tone="warn">Alcuni prodotti sono sotto zero: sono stati venduti più pezzi di quelli registrati come preparati. Registra la produzione mancante.</Notice>}
        {can("production.create") && <div className="row end" style={{ marginTop: 10 }}><Button variant="primary" icon={LuFactory} busy={busy} onClick={produce}>Registra produzione</Button></div>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Controllo ammanchi</h2><DateRange from={from} to={to} onChange={setRange} compact /></div>
        <p className="muted small" style={{ marginTop: 0 }}>Pezzi che dovevano esserci = iniziali + preparati − venduti − omaggi − sprechi. Se alla conta ne trovi meno, la differenza è un <b>ammanco</b>:
          pezzi usciti senza essere battuti in cassa (regalati, mangiati, rubati o non registrati).</p>
        <div className="stats">
          <div className={`stat ${totMissing > 0 ? "stat-bad" : "stat-good"}`}><span className="stat-label">Pezzi mancanti nel periodo</span><span className="stat-value">{F.num(totMissing)}</span></div>
          {costs && <div className={`stat ${Number(rep.data?.missing_value) > 0 ? "stat-bad" : ""}`}><span className="stat-label">Valore al costo</span><span className="stat-value">{F.eur(rep.data?.missing_value)}</span></div>}
        </div>
        <ErrorBox error={rep.error} onRetry={rep.reload} />
        <DataTable rows={items} empty="Nessun dato nel periodo" rowClass={(r) => (Number(r.missing_qty) > 0 ? "bad" : "")} columns={[
          { key: "name", label: "Prodotto", render: (r) => <><b style={{ fontWeight: 600 }}>{r.name}</b><span className="sub">{r.last_count ? `ultima conta ${F.datetime(r.last_count)}` : "mai contato"}</span></> },
          { key: "opening", label: "Iniziali", align: "right", render: (r) => F.num(r.opening) },
          { key: "produced", label: "Preparati", align: "right", render: (r) => F.num(r.produced) },
          { key: "sold", label: "Venduti", align: "right", render: (r) => F.num(r.sold) },
          { key: "given", label: "Omaggi", align: "right", render: (r) => F.num(r.given) },
          { key: "wasted", label: "Sprechi", align: "right", render: (r) => F.num(r.wasted) },
          { key: "missing_qty", label: "Mancanti", align: "right", sortValue: (r) => Number(r.missing_qty),
            render: (r) => Number(r.missing_qty) ? <b className="neg">{F.num(r.missing_qty)} <span className="sub">{F.pct(r.missing_pct)} dei pezzi usciti</span></b>
              : Number(r.surplus_qty) ? <span>+{F.num(r.surplus_qty)} in più</span> : "0" },
          costs && { key: "missing_value", label: "Valore", type: "money" },
          { key: "closing", label: "Restano (teorici)", align: "right", render: (r) => F.num(r.closing) },
        ].filter(Boolean)} />
        {(rep.data?.days || []).length > 0 && <>
          <h3 style={{ marginTop: 16 }}>Differenze trovate alle conte</h3>
          <ul className="list-plain">{rep.data.days.map((d, i) => (
            <li key={i}><span>{F.date(d.day)} · {d.name}{d.counted_by ? <span className="muted small"> · contato da {d.counted_by}</span> : null}</span>
              <span className={Number(d.diff) < 0 ? "neg" : ""}>{Number(d.diff) > 0 ? "+" : ""}{F.num(d.diff)} pz{costs && d.value !== undefined ? ` · ${F.eur(d.value)}` : ""}</span></li>))}</ul>
        </>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Omaggi e assaggi</h2></div>
        <p className="muted small" style={{ marginTop: 0 }}>Registrati dalla cassa con «Omaggio / assaggio»: prezzo 0 €, i pezzi escono dal magazzino.</p>
        <DataTable rows={gifts.data || []} empty="Nessun omaggio nel periodo" rowClass={(r) => (r.voided_at ? "muted" : "")} columns={[
          { key: "given_at", label: "Quando", type: "datetime" },
          { key: "summary", label: "Cosa", render: (r) => <>{r.summary}{r.notes && <span className="sub">{r.notes}</span>}{r.voided_at && <span className="sub">annullato: {r.void_reason}</span>}</> },
          { key: "user_name", label: "Chi" },
          costs && { key: "cost_total", label: "Costo", type: "money" },
          can("sales.void") && { key: "x", label: "", sortable: false, render: (r) => !r.voided_at && <Button size="sm" variant="ghost" onClick={() => setVoiding(r)}>Annulla</Button> },
        ].filter(Boolean)} />
      </div>
      {voiding && <ReasonModal title="Annulla omaggio" onClose={() => setVoiding(null)}
        onConfirm={async (reason) => { await api.post(`/giveaways/${voiding.id}/void`, { reason }); setVoiding(null); toast("Omaggio annullato", "ok"); reloadAll(); }} />}
    </div>
  );
}
