import React, { useEffect, useMemo, useState } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { api, qs } from "../api.js";
import * as F from "../fmt.js";
import {
  Badge, Button, Check, Combo, DataTable, ErrorBox, Field, Input, Loading, Notice, NumInput, PageHeader, ReasonModal, Select, Tabs,
  navigate, useAction, useApp, useData,
} from "../ui.jsx";
import { compatibleUnits } from "./Inventory.jsx";

const PO_STATUS = { bozza: ["Bozza", "neutral"], inviato: ["Inviato", "info"], parziale: ["Ricevuto in parte", "warn"], ricevuto: ["Ricevuto", "good"],
  chiuso: ["Chiuso", "neutral"], annullato: ["Annullato", "bad"] };

export function Orders() {
  const { can } = useApp();
  const [tab, setTab] = useState("ordini");
  const [status, setStatus] = useState("");
  const pos = useData(`/purchase-orders${qs({ status })}`);
  const rec = useData(tab === "ricevimenti" ? "/receipts" : null);
  const [voiding, setVoiding] = useState(null);
  const [run] = useAction();
  return (
    <>
      <PageHeader title="Ordini e ricevimenti" sub="Il magazzino si aggiorna solo quando la merce arriva davvero."
        actions={<>
          {can("purchasing.receive") && <Button onClick={() => navigate("/ricevimento")}>Ricevi merce senza ordine</Button>}
          {can("purchasing.edit") && <Button variant="primary" icon={LuPlus} onClick={() => navigate("/ordini/nuovo")}>Nuovo ordine</Button>}
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "ordini", label: "Ordini di acquisto" }, { value: "ricevimenti", label: "Ricevimenti merce" }]} />
      {tab === "ordini" ? (
        <>
          <div className="row" style={{ marginBottom: 12 }}><span style={{ width: 200 }}><Select value={status} onChange={setStatus} placeholder="Tutti gli stati"
            options={Object.entries(PO_STATUS).map(([v, [l]]) => ({ value: v, label: l }))} /></span></div>
          <ErrorBox error={pos.error} />
          <DataTable rows={pos.data || []} onRowClick={(r) => navigate(`/ordini/${r.id}`)} empty="Nessun ordine" columns={[
            { key: "number", label: "Numero" }, { key: "order_date", label: "Data", type: "date" }, { key: "supplier_name", label: "Fornitore" },
            { key: "expected_date", label: "Consegna prevista", type: "date" }, { key: "n_lines", label: "Righe", type: "number" },
            { key: "total_net", label: "Totale netto", type: "money" },
            { key: "status", label: "Stato", render: (r) => <Badge tone={PO_STATUS[r.status][1]}>{PO_STATUS[r.status][0]}</Badge> }]} />
        </>
      ) : (
        <DataTable rows={rec.data || []} empty="Nessun ricevimento" rowClass={(r) => (r.voided_at ? "voided" : "")}
          onRowClick={(r) => r.expense_id && navigate(`/spese/${r.expense_id}`)}
          columns={[
            { key: "received_at", label: "Data", type: "datetime" }, { key: "supplier_name", label: "Fornitore" }, { key: "doc_ref", label: "Documento" },
            { key: "po_number", label: "Ordine" }, { key: "n_lines", label: "Righe", type: "number" },
            can("inventory.costs") && { key: "total_net", label: "Valore netto", type: "money" },
            { key: "expense_id", label: "Spesa", render: (r) => (r.expense_id ? <Badge tone="good">collegata</Badge> : <Badge>nessuna</Badge>) },
            { key: "user_name", label: "Utente" },
            can("inventory.reverse") && { key: "a", label: "", sortable: false, render: (r) => !r.voided_at && !r.expense_id && (
              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setVoiding(r); }}>Annulla</Button>) },
          ].filter(Boolean)} />
      )}
      {voiding && <ReasonModal title="Annulla ricevimento" message="La merce verrà tolta dal magazzino con uno storno alla data del ricevimento." onClose={() => setVoiding(null)}
        onConfirm={async (reason) => { const ok = await run(() => api.post(`/receipts/${voiding.id}/void`, { reason }), "Ricevimento annullato"); if (ok) rec.reload(); return ok; }} />}
    </>
  );
}

function useItemOptions() {
  const items = useData("/items");
  return [items.data || [], useMemo(() => (items.data || []).map((i) => ({ value: i.id, label: i.name, sub: `${i.sku} · ${i.unit_code}`, unit: i.unit_code, vat: i.vat_rate,
    price: i.last_purchase_price, supplier: i.default_supplier_id })), [items.data])];
}

export function OrderDetail({ params, query }) {
  const isNew = params.id === "nuovo";
  const { can } = useApp();
  const { data: po, error, loading, reload } = useData(isNew ? null : `/purchase-orders/${params.id}`);
  const sups = useData("/suppliers");
  const [, itemOpts] = useItemOptions();
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (isNew) setF({ supplier_id: query.supplier ? Number(query.supplier) : "", order_date: F.todayISO(), expected_date: "", notes: "", lines: [{ item_id: "", qty_ordered: "", unit_price: "", vat_rate: "10" }] });
    else if (po) setF({ ...po, expected_date: po.expected_date || "", notes: po.notes || "", lines: po.lines.map((l) => ({ item_id: l.item_id, qty_ordered: F.toInput(l.qty_ordered), unit_price: F.toInput(l.unit_price), vat_rate: F.toInput(l.vat_rate) })) });
  }, [po, isNew]);
  if (!isNew && loading && !po) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;
  const editable = can("purchasing.edit") && (isNew || ((po.status === "bozza" || po.status === "inviato") && !po.lines.some((l) => Number(l.qty_received) > 0)));
  const setLine = (i, k, v) => setF((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const total = f.lines.reduce((s, l) => s + (Number(F.parseNum(l.qty_ordered)) || 0) * (Number(F.parseNum(l.unit_price)) || 0), 0);
  const save = async (thenStatus) => {
    const body = { supplier_id: Number(f.supplier_id), order_date: f.order_date, expected_date: f.expected_date || null, notes: f.notes || null,
      lines: f.lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, qty_ordered: F.parseNum(l.qty_ordered), unit_price: F.parseNum(l.unit_price) || "0", vat_rate: F.parseNum(l.vat_rate) || "0" })) };
    const r = await run(() => (isNew ? api.post("/purchase-orders", body) : api.put(`/purchase-orders/${po.id}`, body)), "Ordine salvato");
    if (!r) return;
    const id = isNew ? r.id : po.id;
    if (thenStatus) await run(() => api.post(`/purchase-orders/${id}/status`, { status: thenStatus }));
    if (isNew) navigate(`/ordini/${id}`); else reload();
  };
  const setStatus = async (status) => { if (await run(() => api.post(`/purchase-orders/${po.id}/status`, { status }), "Stato aggiornato")) reload(); };
  const supplier = (sups.data || []).find((s) => String(s.id) === String(f.supplier_id));
  return (
    <>
      <PageHeader back={{ to: "/ordini", label: "Ordini" }} title={isNew ? "Nuovo ordine di acquisto" : `Ordine ${po.number}`}
        sub={!isNew && <><Badge tone={PO_STATUS[po.status][1]}>{PO_STATUS[po.status][0]}</Badge> {po.supplier_name}</>}
        actions={!isNew && <>
          {po.status === "bozza" && can("purchasing.edit") && <Button onClick={() => setStatus("inviato")}>Segna come inviato</Button>}
          {["inviato", "parziale"].includes(po.status) && can("purchasing.receive") && <Button variant="primary" onClick={() => navigate(`/ricevimento?po=${po.id}`)}>Registra arrivo merce</Button>}
          {po.status === "parziale" && can("purchasing.edit") && <Button onClick={() => setStatus("chiuso")}>Chiudi (resto non arriverà)</Button>}
          {["bozza", "inviato"].includes(po.status) && can("purchasing.edit") && <Button variant="danger" onClick={() => setStatus("annullato")}>Annulla ordine</Button>}
          {po.supplier_email && <a className="btn" href={`mailto:${po.supplier_email}?subject=${encodeURIComponent("Ordine " + po.number)}&body=${encodeURIComponent(po.lines.map((l) => `${l.name}: ${F.num(l.qty_ordered)} ${l.unit_code}`).join("\n"))}`}>Invia per e-mail</a>}
        </>} />
      <div className="card">
        <div className="grid g4">
          <Field label="Fornitore" required className="span2">{editable ? <Combo options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name }))} value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} /> : <Input value={po.supplier_name} readOnly />}</Field>
          <Field label="Data ordine"><Input type="date" value={f.order_date} onChange={(e) => setF({ ...f, order_date: e.target.value })} disabled={!editable} /></Field>
          <Field label="Consegna prevista" hint={supplier?.lead_time_days ? `Di solito ${supplier.lead_time_days} giorni` : null}><Input type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} disabled={!editable} /></Field>
        </div>
        <table className="lines-editor" style={{ marginTop: 14 }}>
          <thead><tr><th style={{ width: "40%" }}>Articolo</th><th>Quantità</th><th>Prezzo netto unit.</th><th>IVA %</th><th className="r">Totale</th>{!isNew && <th className="r">Ricevuto</th>}<th /></tr></thead>
          <tbody>{f.lines.map((l, i) => {
            const opt = itemOpts.find((o) => o.value === l.item_id);
            return (
              <tr key={i}>
                <td className="wide">{editable ? <Combo options={itemOpts} value={l.item_id} onChange={(v, o) => setF((s) => ({ ...s, lines: s.lines.map((x, j) => (j === i ? { ...x, item_id: v, unit_price: x.unit_price || F.toInput(o.price ? Number(o.price).toFixed(4) : ""), vat_rate: F.toInput(o.vat) } : x)) }))} /> : opt?.label || po.lines[i]?.name}</td>
                <td><NumInput value={l.qty_ordered} onChange={(v) => setLine(i, "qty_ordered", v)} suffix={opt?.unit} disabled={!editable} /></td>
                <td><NumInput value={l.unit_price} onChange={(v) => setLine(i, "unit_price", v)} suffix="€" disabled={!editable} /></td>
                <td><NumInput value={l.vat_rate} onChange={(v) => setLine(i, "vat_rate", v)} disabled={!editable} /></td>
                <td className="r">{F.eur((Number(F.parseNum(l.qty_ordered)) || 0) * (Number(F.parseNum(l.unit_price)) || 0))}</td>
                {!isNew && <td className="r">{po.lines[i] ? `${F.num(po.lines[i].qty_received)} ${po.lines[i].unit_code}` : ""}</td>}
                <td>{editable && <Button size="sm" variant="ghost" icon={LuTrash2} aria-label="Rimuovi" onClick={() => setF((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }))} />}</td>
              </tr>);
          })}</tbody>
        </table>
        {editable && <Button size="sm" icon={LuPlus} style={{ marginTop: 8 }} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, { item_id: "", qty_ordered: "", unit_price: "", vat_rate: "10" }] }))}>Aggiungi riga</Button>}
        <div className="row between" style={{ marginTop: 14 }}>
          <span>Totale netto <b className="tabular">{F.eur(total)}</b></span>
          {editable && <div className="row"><Button busy={busy} onClick={() => save()}>Salva bozza</Button>
            {(isNew || po.status === "bozza") && <Button variant="primary" busy={busy} onClick={() => save("inviato")}>Salva e segna come inviato</Button>}</div>}
        </div>
      </div>
      {!isNew && po.receipts.length > 0 && <div className="card"><div className="card-head"><h2>Arrivi registrati</h2></div>
        <ul className="list-plain">{po.receipts.map((r) => <li key={r.id}><span>{F.datetime(r.received_at)} {r.doc_ref ? `· ${r.doc_ref}` : ""}</span>{r.voided_at && <Badge tone="bad">annullato</Badge>}</li>)}</ul></div>}
      {!isNew && po.expenses.length > 0 && <div className="card"><div className="card-head"><h2>Fatture collegate</h2></div>
        <ul className="list-plain">{po.expenses.map((e) => <li key={e.id}><a href={`#/spese/${e.id}`}>{e.description}</a><span>{F.eur(e.total_amount)} · {F.STATUS_LABELS[e.status]}</span></li>)}</ul></div>}
    </>
  );
}

/** Ricevimento merce: carica il magazzino e (facoltativo) registra la fattura collegata. */
export function ReceiveGoods({ query }) {
  const { can, toast } = useApp();
  const look = useData("/lookups");
  const sups = useData("/suppliers");
  const [items, itemOpts] = useItemOptions();
  const po = useData(query.po ? `/purchase-orders/${query.po}` : null);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => {
    if (query.po && !po.data) return;
    if (f) return;
    const p = po.data;
    setF({
      supplier_id: p ? p.supplier_id : "", doc_ref: "", received_at: "", notes: "",
      lines: p ? p.lines.filter((l) => Number(l.qty_missing) > 0).map((l) => ({ item_id: l.item_id, po_line_id: l.id, qty: F.toInput(l.qty_missing), qty_unit: l.unit_code,
        unit_cost: F.toInput(l.unit_price), vat_rate: F.toInput(l.vat_rate), lot_code: "", expiry_date: "" })) :
        [{ item_id: "", qty: "", qty_unit: "", unit_cost: "", vat_rate: "", lot_code: "", expiry_date: "" }],
      expense: { create: can("expenses.edit"), doc_number: "", doc_date: F.todayISO(), due_date: "", paid_now: false, payment_method_id: "", account_id: "", net_amount: "", vat_amount: "" },
    });
  }, [po.data]);
  if (!f) return <Loading />;
  const setLine = (i, k, v) => setF((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const lineNet = (l) => (Number(F.parseNum(l.qty)) || 0) * (Number(F.parseNum(l.unit_cost)) || 0);
  const net = f.lines.reduce((s, l) => s + lineNet(l), 0);
  const vat = f.lines.reduce((s, l) => s + Math.round(lineNet(l) * (Number(F.parseNum(l.vat_rate)) || 0)) / 100, 0);
  const units = look.data?.units || [];
  const submit = async () => {
    const body = {
      supplier_id: f.supplier_id || null, po_id: query.po ? Number(query.po) : null, doc_ref: f.doc_ref || null, received_at: f.received_at || null, notes: f.notes || null,
      lines: f.lines.filter((l) => l.item_id && F.parseNum(l.qty)).map((l) => ({ item_id: l.item_id, po_line_id: l.po_line_id || null, qty: F.parseNum(l.qty), qty_unit: l.qty_unit || null,
        unit_cost: F.parseNum(l.unit_cost) || "0", vat_rate: F.parseNum(l.vat_rate), lot_code: l.lot_code || null, expiry_date: l.expiry_date || null })),
      expense: f.expense.create ? { ...f.expense, net_amount: F.parseNum(f.expense.net_amount), vat_amount: F.parseNum(f.expense.vat_amount),
        due_date: f.expense.due_date || null, payment_method_id: f.expense.payment_method_id || null, account_id: f.expense.account_id || null } : { create: false },
    };
    const r = await run(() => api.post("/receipts", body));
    if (r) {
      toast(`Merce caricata in magazzino${r.expense_id ? " e spesa registrata" : ""}`, "ok");
      navigate(r.expense_id ? `/spese/${r.expense_id}` : query.po ? `/ordini/${query.po}` : "/magazzino");
    }
  };
  const e = f.expense;
  const setE = (k) => (v) => setF((s) => ({ ...s, expense: { ...s.expense, [k]: v?.target ? v.target.value : v } }));
  return (
    <>
      <PageHeader back={query.po ? { to: `/ordini/${query.po}`, label: "Ordine" } : { to: "/ordini", label: "Ordini" }} title="Ricevi merce"
        sub="Carica le quantità arrivate e, se vuoi, registra subito la fattura: il costo non verrà conteggiato due volte." />
      <div className="card">
        <div className="grid g4">
          <Field label="Fornitore" className="span2">{po.data ? <Input value={po.data.supplier_name} readOnly /> :
            <Combo options={(sups.data || []).map((s) => ({ value: s.id, label: s.legal_name }))} value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} placeholder="Cerca fornitore" />}</Field>
          <Field label="DDT / documento di trasporto"><Input value={f.doc_ref} onChange={(ev) => setF({ ...f, doc_ref: ev.target.value })} /></Field>
          <Field label="Data e ora di arrivo" hint="Vuoto = adesso"><Input type="datetime-local" value={f.received_at} onChange={(ev) => setF({ ...f, received_at: ev.target.value })} max={F.nowLocalInput()} /></Field>
        </div>
        <table className="lines-editor" style={{ marginTop: 14 }}>
          <thead><tr><th style={{ width: "32%" }}>Articolo</th><th>Quantità</th><th>Unità</th><th>Costo netto unit.</th><th>IVA %</th><th>Lotto / scadenza</th><th className="r">Totale</th><th /></tr></thead>
          <tbody>{f.lines.map((l, i) => {
            const it = items.find((x) => x.id === l.item_id);
            return (
              <tr key={i}>
                <td className="wide"><Combo options={itemOpts} value={l.item_id} onChange={(v, o) => setF((s) => ({ ...s, lines: s.lines.map((x, j) => (j === i ? { ...x, item_id: v, qty_unit: o.unit,
                  unit_cost: x.unit_cost || F.toInput(o.price ? Number(o.price).toFixed(4) : ""), vat_rate: x.vat_rate || F.toInput(o.vat) } : x)) }))} /></td>
                <td><NumInput value={l.qty} onChange={(v) => setLine(i, "qty", v)} /></td>
                <td><Select value={l.qty_unit || it?.unit_code || ""} onChange={(v) => setLine(i, "qty_unit", v)} options={compatibleUnits(units, it?.unit_code).map((u) => ({ value: u.code, label: u.code }))} /></td>
                <td><NumInput value={l.unit_cost} onChange={(v) => setLine(i, "unit_cost", v)} suffix={`€/${l.qty_unit || it?.unit_code || ""}`} /></td>
                <td><NumInput value={l.vat_rate} onChange={(v) => setLine(i, "vat_rate", v)} /></td>
                <td>{it?.track_lots ? <div className="stack" style={{ gap: 4 }}><Input placeholder="Lotto" value={l.lot_code} onChange={(ev) => setLine(i, "lot_code", ev.target.value)} />
                  <Input type="date" value={l.expiry_date} onChange={(ev) => setLine(i, "expiry_date", ev.target.value)} /></div> : <span className="muted small">—</span>}</td>
                <td className="r">{F.eur(lineNet(l))}</td>
                <td><Button size="sm" variant="ghost" icon={LuTrash2} aria-label="Rimuovi" onClick={() => setF((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }))} /></td>
              </tr>);
          })}</tbody>
        </table>
        <Button size="sm" icon={LuPlus} style={{ marginTop: 8 }} onClick={() => setF((s) => ({ ...s, lines: [...s.lines, { item_id: "", qty: "", qty_unit: "", unit_cost: "", vat_rate: "", lot_code: "", expiry_date: "" }] }))}>Aggiungi articolo</Button>
        <p style={{ marginTop: 10 }}>Imponibile <b className="tabular">{F.eur(net)}</b> + IVA <b className="tabular">{F.eur(vat)}</b> = <b className="tabular">{F.eur(net + vat)}</b></p>
      </div>
      {can("expenses.edit") && (
        <div className="card">
          <Check checked={e.create} onChange={setE("create")} label="Registra anche la fattura o ricevuta del fornitore" hint="Crea la spesa da pagare collegata a questo carico" />
          {e.create && (
            <div className="grid g4" style={{ marginTop: 12 }}>
              <Field label="Numero documento"><Input value={e.doc_number} onChange={setE("doc_number")} placeholder={f.doc_ref} /></Field>
              <Field label="Data documento"><Input type="date" value={e.doc_date} onChange={setE("doc_date")} /></Field>
              <Field label="Scadenza" hint="Vuoto = dai giorni del fornitore"><Input type="date" value={e.due_date} onChange={setE("due_date")} /></Field>
              <Field label="Categoria"><Select value={e.category_id || ""} onChange={setE("category_id")} placeholder="Acquisto di materie prime"
                options={(look.data?.["expense-categories"] || []).filter((c) => c.is_inventory).map((c) => ({ value: c.id, label: c.name }))} /></Field>
              <Field label="Imponibile in fattura" hint={`Vuoto = ${F.eur(net)}`}><NumInput value={e.net_amount} onChange={setE("net_amount")} suffix="€" /></Field>
              <Field label="IVA in fattura" hint={`Vuoto = ${F.eur(vat)}`}><NumInput value={e.vat_amount} onChange={setE("vat_amount")} suffix="€" /></Field>
              {can("expenses.pay") && <div className="span2" style={{ paddingTop: 22 }}><Check checked={e.paid_now} onChange={setE("paid_now")} label="Già pagata" /></div>}
              {e.paid_now && <Field label="Pagata con"><Select value={e.payment_method_id} onChange={setE("payment_method_id")} placeholder="—"
                options={(look.data?.["payment-methods"] || []).filter((m) => m.received_immediately).map((m) => ({ value: m.id, label: m.name }))} /></Field>}
            </div>
          )}
        </div>
      )}
      <div className="row end"><Button variant="primary" size="lg" busy={busy} onClick={submit} disabled={!f.lines.some((l) => l.item_id && F.parseNum(l.qty))}>Carica in magazzino</Button></div>
    </>
  );
}
