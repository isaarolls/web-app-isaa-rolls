import React, { useEffect, useMemo, useState } from "react";
import { LuMinus, LuPlus, LuTrash2, LuChevronUp } from "react-icons/lu";
import { api } from "../api.js";
import * as F from "../fmt.js";
import { Button, Check, ErrorBox, Field, Input, Loading, NumInput, PageHeader, Select, Tabs, Notice, useAction, useApp, useData } from "../ui.jsx";

const TILE_COLORS = ["var(--brand-pantone)", "var(--logo-yellow)", "var(--logo-pink)", "var(--logo-orange)"];

export function Pos() {
  const { can, toast } = useApp();
  const prods = useData("/products");
  const look = useData("/lookups");
  const [mode, setMode] = useState("analitica");
  const [cat, setCat] = useState("tutti");
  const [cart, setCart] = useState([]);
  const [channel, setChannel] = useState("");
  const [method, setMethod] = useState("");
  const [split, setSplit] = useState(false);
  const [splitAmounts, setSplitAmounts] = useState({});
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState("");
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(false);
  const canBackdate = can("sales.void");
  const [summary, setSummary] = useState({ amount: "", vat: "", description: "" });
  const [run, busy] = useAction();

  const channels = (look.data?.channels || []).filter((c) => c.is_active);
  const methods = (look.data?.["payment-methods"] || []).filter((m) => m.is_active);
  useEffect(() => {
    if (!channel && channels.length) setChannel(String(channels[0].id));
  }, [channels.length]);
  useEffect(() => {
    const ch = channels.find((c) => String(c.id) === channel);
    if (ch) setMethod(String(ch.default_payment_method_id || methods[0]?.id || ""));
  }, [channel, methods.length]);

  const products = prods.data || [];
  const cats = useMemo(() => {
    const m = new Map();
    products.forEach((p) => m.set(p.category_name || "Altro", true));
    return ["tutti", ...m.keys()];
  }, [products]);
  const shown = cat === "tutti" ? products : products.filter((p) => (p.category_name || "Altro") === cat);
  const catIndex = (name) => Math.max(0, cats.indexOf(name || "Altro") - 1);

  const add = (p) => setCart((c) => {
    const i = c.findIndex((x) => x.product.id === p.id);
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n; }
    return [...c, { product: p, qty: 1, price: p.sale_price }];
  });
  const setQty = (id, q) => setCart((c) => c.flatMap((x) => (x.product.id === id ? (q <= 0 ? [] : [{ ...x, qty: q }]) : [x])));
  const qtyOf = (id) => cart.find((x) => x.product.id === id)?.qty || 0;

  const subtotal = cart.reduce((s, x) => s + x.qty * Number(x.price), 0);
  const disc = Number(F.parseNum(discount) || 0) || 0;
  const total = mode === "analitica" ? Math.max(0, subtotal - disc) : Number(F.parseNum(summary.amount) || 0) || 0;
  const splitSum = Object.values(splitAmounts).reduce((s, v) => s + (Number(F.parseNum(v)) || 0), 0);
  const methodObj = methods.find((m) => String(m.id) === method);

  const reset = () => { setExtra(false); setCart([]); setDiscount(""); setNotes(""); setSplit(false); setSplitAmounts({}); setSummary({ amount: "", vat: "", description: "" }); setOpen(false); };

  const submit = async () => {
    const body = { channel_id: Number(channel), mode, notes: notes || null };
    if (when) body.sold_at = when;
    if (mode === "analitica") {
      body.lines = cart.map((x) => ({ product_id: x.product.id, qty: String(x.qty) }));
      body.discount = disc ? String(F.parseNum(discount)) : "0";
    } else {
      body.lines = [{ description: summary.description || "Incasso giornaliero", qty: "1", unit_price: F.parseNum(summary.amount),
        vat_rate: summary.vat ? F.parseNum(summary.vat) : null }];
    }
    if (split) {
      body.payments = Object.entries(splitAmounts).filter(([, v]) => Number(F.parseNum(v)) > 0)
        .map(([mid, v]) => ({ method_id: Number(mid), amount: F.parseNum(v) }));
    } else if (method) {
      body.payments = [{ method_id: Number(method), amount: total.toFixed(2) }];
    }
    const r = await run(() => api.post("/sales", body));
    if (r) {
      toast(`Vendita n. ${r.number} registrata: ${F.eur(r.gross_total)}`, "ok");
      reset();
    }
  };

  const gift = mode === "omaggio";
  const submitGift = async () => {
    const body = { lines: cart.map((x) => ({ product_id: x.product.id, qty: String(x.qty) })), notes: notes || null };
    if (when) body.at = when;
    const r = await run(() => api.post("/giveaways", body));
    if (r) { toast(`Omaggio registrato: ${r.summary}`, "ok"); reset(); }
  };

  if (prods.loading || look.loading) return <Loading />;
  const canSubmit = total > 0 && channel && (mode === "riepilogo" || cart.length) &&
    (!split || Math.abs(splitSum - total) < 0.005) && (split || method);

  const cartPanel = (
    <aside className={`cart ${open ? "open" : ""}`} aria-label="Scontrino in corso">
      <div className="cart-head">
        <div className="row between">
          <h2>{gift ? "Omaggi e assaggi" : mode === "analitica" ? "Scontrino" : "Incasso giornaliero"}</h2>
          <button className="btn btn-ghost btn-sm only-mobile" onClick={() => setOpen(false)}>Chiudi</button>
        </div>
        <div className={canBackdate && !gift ? "grid g2" : ""}>
          {!gift && <Field label="Canale">
            <Select value={channel} onChange={setChannel} options={channels.map((c) => ({ value: String(c.id), label: c.name }))} />
          </Field>}
          {canBackdate && (
            <Field label="Data e ora" hint={when ? null : "Adesso"}>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} max={F.nowLocalInput()} />
            </Field>
          )}
        </div>
      </div>
      {mode !== "riepilogo" ? (
        <div className="cart-lines">
          {cart.length === 0 && <p className="muted" style={{ padding: 12 }}>{gift ? "Tocca i prodotti che hai regalato da assaggiare." : "Tocca un prodotto per aggiungerlo."}</p>}
          {cart.map((x) => (
            <div className="cart-line" key={x.product.id}>
              <span className="nm">{x.product.name}<small>{gift ? "gratis" : `${F.eur(x.price)} cad.`}</small></span>
              <span className="qty-ctl">
                <button onClick={() => setQty(x.product.id, x.qty - 1)} aria-label="Togli uno">{x.qty === 1 ? <LuTrash2 /> : <LuMinus />}</button>
                <span>{x.qty}</span>
                <button onClick={() => setQty(x.product.id, x.qty + 1)} aria-label="Aggiungi uno"><LuPlus /></button>
              </span>
              <span className="tabular" style={{ minWidth: 64, textAlign: "right", fontWeight: 600 }}>{F.eur(gift ? 0 : x.qty * x.price)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="cart-lines" style={{ padding: 14 }}>
          <div className="stack">
            <Notice tone="info">Registra il totale incassato senza i singoli scontrini. Non scarica il magazzino.</Notice>
            <Field label="Importo incassato (IVA inclusa)" required><NumInput value={summary.amount} onChange={(v) => setSummary({ ...summary, amount: v })} suffix="€" /></Field>
            <Field label="Aliquota IVA" hint="Vuoto = aliquota predefinita"><NumInput value={summary.vat} onChange={(v) => setSummary({ ...summary, vat: v })} suffix="%" /></Field>
            <Field label="Descrizione"><Input value={summary.description} onChange={(e) => setSummary({ ...summary, description: e.target.value })} placeholder="Incasso giornaliero" /></Field>
          </div>
        </div>
      )}
      {gift ? (
        <div className="cart-foot">
          <Field label="Nota (facoltativa)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. assaggi ai passanti" /></Field>
          <span className="small muted">Prezzo 0 €: i pezzi escono dal magazzino e il loro costo resta registrato come omaggio.</span>
          <div className="cart-total"><span className="muted">Totale</span><b>{F.eur(0)}</b></div>
          <Button variant="primary" size="lg" busy={busy} disabled={!cart.length} onClick={submitGift}>Registra omaggio</Button>
        </div>
      ) : (
      <div className="cart-foot">
        {mode === "analitica" && !extra && !disc && !notes && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setExtra(true)}>Aggiungi sconto o nota</button>
        )}
        {mode === "analitica" && (extra || disc > 0 || notes) && (
          <div className="grid g2">
            <Field label="Sconto"><NumInput value={discount} onChange={setDiscount} suffix="€" /></Field>
            <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        )}
        {!split ? (
          <div className="pay-methods" role="radiogroup" aria-label="Metodo di pagamento">
            {methods.map((m) => (
              <button key={m.id} role="radio" aria-checked={String(m.id) === method} className={String(m.id) === method ? "on" : ""}
                onClick={() => setMethod(String(m.id))}>{m.name}</button>
            ))}
          </div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {methods.map((m) => (
              <div key={m.id} className="row" style={{ flexWrap: "nowrap" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{m.name}</span>
                <span style={{ width: 120 }}><NumInput value={splitAmounts[m.id] || ""} onChange={(v) => setSplitAmounts({ ...splitAmounts, [m.id]: v })} suffix="€" /></span>
              </div>
            ))}
            <span className={`small ${Math.abs(splitSum - total) < 0.005 ? "muted" : "neg"}`}>Ripartiti {F.eur(splitSum)} su {F.eur(total)}</span>
          </div>
        )}
        <Check checked={split} onChange={setSplit} label="Pagamento con più metodi" />
        {methodObj && !split && !methodObj.received_immediately && <span className="small muted">Resterà tra i crediti da incassare finché la piattaforma non accredita.</span>}
        <div className="cart-total"><span className="muted">Totale</span><b>{F.eur(total)}</b></div>
        <Button variant="primary" size="lg" busy={busy} disabled={!canSubmit} onClick={submit}>Registra vendita</Button>
      </div>
      )}
    </aside>
  );

  return (
    <>
      <PageHeader title="Vendi" actions={
        <Tabs value={mode} onChange={(m) => { if ((m === "omaggio") !== gift) reset(); setMode(m); }} tabs={[
          { value: "analitica", label: "Per prodotto" }, { value: "omaggio", label: "Omaggio / assaggio" }, { value: "riepilogo", label: "Totale giornaliero" }]} />
      } />
      <ErrorBox error={prods.error || look.error} />
      <div className="pos-layout">
        <div>
          {mode !== "riepilogo" ? (
            <>
              {gift && <Notice tone="info">Seleziona i roll o le ciambelle regalati da assaggiare: non si incassa nulla, ma la giacenza scende.</Notice>}
              <div className="pos-cats">
                {cats.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c === "tutti" ? "Tutti" : c}</button>)}
              </div>
              {products.length === 0 ? (
                <Notice tone="info">Non ci sono prodotti in vendita. {can("products.edit") ? "Creali in Prodotti e ricette." : "Chiedi al responsabile di crearli."}</Notice>
              ) : (
                <div className="pos-grid">
                  {shown.map((p) => (
                    <button key={p.id} className="pos-tile" onClick={() => add(p)}
                      style={{ "--tile": p.color || TILE_COLORS[catIndex(p.category_name) % TILE_COLORS.length] }}>
                      {qtyOf(p.id) > 0 && <span className="qty-badge">{qtyOf(p.id)}</span>}
                      <b>{p.name}</b>
                      <span className="price">{gift ? "gratis" : F.eur(p.sale_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Notice tone="info">Usa questa modalità per registrare in un'unica riga quanto incassato, ad esempio a fine giornata o per giorni passati.
              Nei report sarà distinta dalle vendite registrate prodotto per prodotto.</Notice>
          )}
        </div>
        {cartPanel}
      </div>
      {(cart.length > 0 || mode === "riepilogo") && !open && (
        <button className="mobile-cart-bar" onClick={() => setOpen(true)}>
          <span><LuChevronUp /> {mode === "riepilogo" ? "Incasso giornaliero" : `${cart.reduce((s, x) => s + x.qty, 0)} ${gift ? "in omaggio" : "articoli"}`}</span>
          <b>{F.eur(gift ? 0 : total)}</b>
        </button>
      )}
    </>
  );
}
