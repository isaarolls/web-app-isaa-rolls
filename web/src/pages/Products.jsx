import React, { useEffect, useMemo, useRef, useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { api } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, Combo, DataTable, ErrorBox, Field, Input, Loading, Modal, Notice, NumInput, PageHeader, Select, Textarea,
  navigate, nums, useAction, useApp, useData,
} from "../ui.jsx";
import { compatibleUnits } from "./Inventory.jsx";

export function Products() {
  const { can } = useApp();
  const [inactive, setInactive] = useState(false);
  const { data, error, loading, reload } = useData(`/products?with_cost=1&active=${inactive ? 0 : 1}`);
  const [creating, setCreating] = useState(false);
  const costs = can("products.costs");
  return (
    <>
      <PageHeader title="Prodotti e ricette" sub="Prodotti in vendita con la loro distinta base: costo, margine e prezzo consigliato si aggiornano con i costi di magazzino."
        actions={can("products.edit") && <Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>Nuovo prodotto</Button>} />
      <div className="row" style={{ marginBottom: 12 }}><Check checked={inactive} onChange={setInactive} label="Includi prodotti non più in vendita" /></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : (
        <DataTable rows={data || []} onRowClick={(r) => navigate(`/prodotti/${r.id}`)} empty="Nessun prodotto: crea il primo"
          rowClass={(r) => (costs && r.card?.gross_margin_pct !== null && r.card && Number(r.card.gross_margin_pct) < Number(r.card.target_margin_pct) ? "warn" : "")}
          columns={[
            { key: "name", label: "Prodotto", render: (r) => <><b style={{ fontWeight: 600 }}>{r.name}</b><span className="sub">{r.category_name || ""}{r.is_active ? "" : " · non in vendita"}</span></> },
            { key: "sale_price", label: "Prezzo", type: "money" },
            { key: "recipe", label: "Ricetta", sortable: false, render: (r) => r.card?.has_recipe ? (r.card.missing_costs ? <Badge tone="warn">costi mancanti</Badge> : <Badge tone="good">sì</Badge>) : <Badge tone="bad">manca</Badge> },
            costs && { key: "cost", label: "Costo diretto", align: "right", sortValue: (r) => Number(r.card?.unit_cost), render: (r) => F.eur(r.card?.unit_cost) },
            costs && { key: "fc", label: "Food cost", align: "right", sortValue: (r) => Number(r.card?.food_cost_pct), render: (r) => F.pct(r.card?.food_cost_pct) },
            costs && { key: "margin", label: "Margine", align: "right", sortValue: (r) => Number(r.card?.gross_margin), render: (r) => <>{F.eur(r.card?.gross_margin)} <span className="sub">{F.pct(r.card?.gross_margin_pct)}</span></> },
            costs && { key: "sugg", label: "Prezzo consigliato", align: "right", render: (r) => <>{F.eur(r.card?.suggested_price)}<span className="sub">margine obiettivo {F.pct(r.card?.target_margin_pct)}</span></> },
          ].filter(Boolean)} />
      )}
      {creating && <ProductModal onClose={() => setCreating(false)} onSaved={(r) => navigate(`/prodotti/${r.id}`)} />}
    </>
  );
}

function ProductModal({ product, onClose, onSaved }) {
  const look = useData("/lookups");
  const { settings } = useApp();
  const [f, setF] = useState(() => product ? { ...product, sale_price: F.toInput(product.sale_price), vat_rate: F.toInput(product.vat_rate),
    target_margin_pct: F.toInput(product.target_margin_pct) } : { name: "", code: "", category_id: "", sale_price: "", vat_rate: F.toInput(settings.default_sale_vat_rate ?? 10),
    target_margin_pct: "", unload_stock: true, is_active: true, sort_order: 0, description: "", color: "" });
  const [run, busy] = useAction();
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const submit = async () => {
    const body = nums({ ...f, category_id: f.category_id || null, code: f.code || null, color: f.color || null }, ["sale_price", "vat_rate", "target_margin_pct"]);
    const r = await run(() => (product ? api.put(`/products/${product.id}`, body) : api.post("/products", body)), product ? "Prodotto aggiornato" : "Prodotto creato");
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal title={product ? "Modifica prodotto" : "Nuovo prodotto"} onClose={onClose}
      footer={<><Button onClick={onClose}>Annulla</Button><Button variant="primary" busy={busy} onClick={submit}>{product ? "Salva modifiche" : "Crea prodotto"}</Button></>}>
      <div className="grid g2">
        <Field label="Nome" required className="span-all"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Categoria"><Select value={f.category_id || ""} onChange={set("category_id")} placeholder="—" options={(look.data?.["product-categories"] || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Codice"><Input value={f.code || ""} onChange={set("code")} /></Field>
        <Field label="Prezzo al pubblico (IVA inclusa)" required><NumInput value={f.sale_price} onChange={set("sale_price")} suffix="€" /></Field>
        <Field label="Aliquota IVA"><NumInput value={f.vat_rate} onChange={set("vat_rate")} suffix="%" /></Field>
        <Field label="Margine obiettivo" hint={`Vuoto = predefinito (${F.num(settings.default_target_margin_pct)}%)`}><NumInput value={f.target_margin_pct} onChange={set("target_margin_pct")} suffix="%" /></Field>
        <Field label="Ordine in cassa" hint="Numeri più bassi compaiono prima"><Input type="number" value={f.sort_order} onChange={set("sort_order")} /></Field>
        <div className="stack span-all" style={{ gap: 8 }}>
          <Check checked={f.unload_stock} onChange={set("unload_stock")} label="Scarica gli ingredienti dal magazzino a ogni vendita" />
          {product && <Check checked={f.is_active} onChange={set("is_active")} label="In vendita" />}
        </div>
      </div>
    </Modal>
  );
}

/** Editor della distinta base (usato per prodotti e semilavorati). */
export function RecipeEditor({ initial, onSave, preview, yieldLabel = "Unità prodotte con queste quantità", showYield = true }) {
  const items = useData("/items");
  const look = useData("/lookups");
  const [lines, setLines] = useState(() => (initial?.lines || []).map((l) => ({ item_id: l.item_id, qty: F.toInput(l.qty), unit_code: l.unit_code, waste_pct: F.toInput(l.waste_pct) || "" })));
  const [yieldQty, setYield] = useState(F.toInput(initial?.yield_qty || 1));
  const [notes, setNotes] = useState("");
  const [card, setCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const units = look.data?.units || [];
  const opts = useMemo(() => (items.data || []).map((i) => ({ value: i.id, label: i.name, sub: `${F.KIND_LABELS[i.kind]} · ${i.unit_code}`, unit: i.unit_code })), [items.data]);
  const body = () => ({ lines: lines.filter((l) => l.item_id && F.parseNum(l.qty)).map((l) => ({ item_id: l.item_id, qty: F.parseNum(l.qty), unit_code: l.unit_code,
    waste_pct: F.parseNum(l.waste_pct) || "0" })), yield_qty: F.parseNum(yieldQty) || "1", notes: notes || null });
  const timer = useRef();
  useEffect(() => {
    if (!preview) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const b = body();
      if (!b.lines.length) { setCard(null); return; }
      try { setCard(await preview(b)); setErr(null); } catch (e) { setErr(e.message); }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [JSON.stringify(lines), yieldQty]);
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const lineCost = (i) => card?.recipe?.lines?.[i]?.line_cost;
  const save = async () => {
    setBusy(true); setErr(null);
    try { await onSave(body()); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <table className="lines-editor">
        <thead><tr><th style={{ width: "42%" }}>Ingrediente o confezione</th><th>Quantità</th><th>Unità</th><th>Calo %</th>{preview && <th className="r">Costo</th>}<th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="wide"><Combo options={opts} value={l.item_id} onChange={(v, o) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, item_id: v, unit_code: x.item_id ? x.unit_code : o.unit } : x)))} placeholder="Scegli articolo…" /></td>
              <td><NumInput value={l.qty} onChange={(v) => setLine(i, "qty", v)} /></td>
              <td><Select value={l.unit_code} onChange={(v) => setLine(i, "unit_code", v)} options={compatibleUnits(units, opts.find((o) => o.value === l.item_id)?.unit || l.unit_code).map((u) => ({ value: u.code, label: u.code }))} /></td>
              <td><NumInput value={l.waste_pct} onChange={(v) => setLine(i, "waste_pct", v)} placeholder="0" /></td>
              {preview && <td className="r">{lineCost(i) !== undefined ? F.eur4(lineCost(i)) : ""}</td>}
              <td><Button variant="ghost" size="sm" icon={LuTrash2} aria-label="Rimuovi riga" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <Button size="sm" icon={LuPlus} onClick={() => setLines((ls) => [...ls, { item_id: "", qty: "", unit_code: "g", waste_pct: "" }])}>Aggiungi ingrediente</Button>
        <span className="muted small">Il «calo» è la parte persa in lavorazione: aumenta la quantità scaricata.</span>
      </div>
      <div className="grid g3">
        {showYield && <Field label={yieldLabel}><NumInput value={yieldQty} onChange={setYield} /></Field>}
        <Field label="Note sulla modifica" className={showYield ? "span2" : "span-all"}><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. aumentata la crema" /></Field>
      </div>
      {card && (
        <div className="stats">
          <div className="stat"><span className="stat-label">Materie prime</span><span className="stat-value">{F.eur(card.materials_cost)}</span></div>
          <div className="stat"><span className="stat-label">Confezione</span><span className="stat-value">{F.eur(card.packaging_cost)}</span></div>
          <div className="stat"><span className="stat-label">Costo diretto</span><span className="stat-value">{F.eur(card.unit_cost)}</span></div>
          <div className="stat"><span className="stat-label">Food cost</span><span className="stat-value">{F.pct(card.food_cost_pct)}</span></div>
          <div className={`stat ${Number(card.gross_margin) < 0 ? "stat-bad" : ""}`}><span className="stat-label">Margine lordo</span><span className="stat-value">{F.eur(card.gross_margin)}</span><span className="stat-sub">{F.pct(card.gross_margin_pct)} del prezzo netto</span></div>
        </div>
      )}
      {card?.missing_costs > 0 && <Notice tone="warn">{card.missing_costs} ingredienti non hanno ancora un costo: registra un acquisto o una giacenza iniziale con il prezzo.</Notice>}
      {err && <Notice tone="bad">{err}</Notice>}
      <Notice tone="info">Salvando crei una nuova versione della ricetta, valida da adesso: le vendite già registrate mantengono il costo della versione precedente.</Notice>
      <div className="row end"><Button variant="primary" busy={busy} onClick={save}>Salva nuova versione</Button></div>
    </div>
  );
}

export function ProductEditor({ params }) {
  const { can, toast } = useApp();
  const { data: p, error, loading, reload } = useData(`/products/${params.id}`);
  const [edit, setEdit] = useState(false);
  const [editRecipe, setEditRecipe] = useState(false);
  const [version, setVersion] = useState(null);
  if (loading && !p) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const c = p.card;
  const costs = can("products.costs");
  return (
    <>
      <PageHeader back={{ to: "/prodotti", label: "Prodotti" }} title={p.name} sub={`${p.category_name || "Senza categoria"} · ${F.eur(p.sale_price)} IVA ${F.num(p.vat_rate)}% inclusa${p.is_active ? "" : " · non in vendita"}`}
        actions={can("products.edit") && <><Button onClick={() => setEdit(true)}>Modifica prodotto</Button>
          <Button variant="primary" onClick={() => setEditRecipe(!editRecipe)}>{editRecipe ? "Chiudi editor" : c.has_recipe ? "Modifica ricetta" : "Crea ricetta"}</Button></>} />
      {costs && c && (
        <div className="stats">
          <div className="stat"><span className="stat-label">Prezzo netto IVA</span><span className="stat-value">{F.eur(c.net_price)}</span></div>
          <div className="stat"><span className="stat-label">Materie prime</span><span className="stat-value">{F.eur(c.materials_cost)}</span></div>
          <div className="stat"><span className="stat-label">Confezione</span><span className="stat-value">{F.eur(c.packaging_cost)}</span></div>
          <div className="stat"><span className="stat-label">Costo diretto per unità</span><span className="stat-value">{F.eur(c.unit_cost)}</span></div>
          <div className="stat"><span className="stat-label">Food cost</span><span className="stat-value">{F.pct(c.food_cost_pct)}</span><span className="stat-sub">costo / prezzo netto</span></div>
          <div className={`stat ${Number(c.gross_margin_pct) < Number(c.target_margin_pct) ? "stat-bad" : "stat-good"}`}><span className="stat-label">Margine lordo</span>
            <span className="stat-value">{F.eur(c.gross_margin)}</span><span className="stat-sub">{F.pct(c.gross_margin_pct)} · obiettivo {F.pct(c.target_margin_pct)}</span></div>
          <div className="stat stat-brand"><span className="stat-label">Prezzo consigliato</span><span className="stat-value">{F.eur(c.suggested_price)}</span>
            <span className="stat-sub">per un margine del {F.pct(c.target_margin_pct)}</span></div>
        </div>
      )}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head"><h2>{editRecipe ? "Nuova versione della ricetta" : c.has_recipe ? `Ricetta – versione ${c.recipe?.version_no ?? ""}` : "Ricetta"}</h2></div>
        {editRecipe ? (
          <RecipeEditor initial={c.recipe} showYield={false}
            preview={costs ? (b) => api.post("/products/preview-cost", { ...b, sale_price: p.sale_price, vat_rate: p.vat_rate, target_margin_pct: p.target_margin_pct }) : null}
            onSave={async (b) => { await api.post(`/products/${p.id}/recipe`, b); toast("Nuova versione della ricetta salvata", "ok"); setEditRecipe(false); reload(); }} />
        ) : c.has_recipe && c.recipe ? (
          <table className="plain-table">
            <thead><tr><th>Ingrediente</th><th className="r">Quantità</th><th className="r">Calo</th><th className="r">Scaricato</th>{costs && <><th className="r">Costo unit.</th><th className="r">Costo</th></>}</tr></thead>
            <tbody>{c.recipe.lines.map((l) => (
              <tr key={l.id}><td><a href={`#/magazzino/${l.item_id}`}>{l.item_name}</a>{l.item_kind === "confezione" && <> <Badge>confezione</Badge></>}{l.cost_missing && <> <Badge tone="warn">costo mancante</Badge></>}</td>
                <td className="r">{F.num(l.qty)} {l.unit_code}</td><td className="r">{Number(l.waste_pct) ? F.pct(l.waste_pct) : ""}</td>
                <td className="r">{F.num(l.qty_stock_unit)} {l.item_unit}</td>
                {costs && <><td className="r">{F.eur4(l.unit_cost)}/{l.item_unit}</td><td className="r">{F.eur4(l.line_cost)}</td></>}</tr>))}
            </tbody>
          </table>
        ) : <p className="muted">Senza ricetta il prodotto non scarica ingredienti e il suo costo risulta zero. Crea la ricetta per calcolare costi e margini.</p>}
      </div>
      {p.versions.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Storico versioni</h2></div>
          <ul className="list-plain">{p.versions.map((v) => (
            <li key={v.id}><span>Versione {v.version_no} · {String(v.valid_from).startsWith("2000-") ? "valida dall'inizio" : `valida dal ${F.datetime(v.valid_from)}`}{v.notes ? ` · ${v.notes}` : ""}</span>
              <span className="muted small">{v.created_by_name} <Button size="sm" variant="ghost" onClick={() => setVersion(v.id)}>Vedi</Button></span></li>))}</ul>
        </div>
      )}
      {edit && <ProductModal product={p} onClose={() => setEdit(false)} onSaved={reload} />}
      {version && <VersionModal id={version} onClose={() => setVersion(null)} />}
    </>
  );
}

function VersionModal({ id, onClose }) {
  const { data } = useData(`/recipe-versions/${id}`);
  return (
    <Modal title={data ? `Versione ${data.version_no}` : "Versione"} onClose={onClose}>
      {!data ? <Loading /> : (
        <>
          <p className="muted small">Costi calcolati con i costi medi di magazzino attuali.</p>
          <table className="plain-table"><tbody>{data.lines.map((l) => <tr key={l.id}><td>{l.item_name}</td><td className="r">{F.num(l.qty)} {l.unit_code}</td>
            {l.line_cost !== undefined && <td className="r">{F.eur4(l.line_cost)}</td>}</tr>)}</tbody></table>
          {data.unit_cost !== undefined && <p style={{ marginTop: 10 }}>Costo diretto: <b>{F.eur(data.unit_cost)}</b></p>}
        </>
      )}
    </Modal>
  );
}
