// Formattazione italiana: euro, numeri con virgola, date gg/mm/aaaa.
const eurF = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const eur4F = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const numF = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 });
const pctF = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const eur = (v) => (v === null || v === undefined || v === "" ? "–" : eurF.format(Number(v)));
export const eur4 = (v) => (v === null || v === undefined || v === "" ? "–" : eur4F.format(Number(v)));
export const num = (v) => (v === null || v === undefined || v === "" ? "–" : numF.format(Number(v)));
export const pct = (v) => (v === null || v === undefined ? "–" : `${pctF.format(Number(v))}%`);

export function date(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
  const d = new Date(s);
  return d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome" });
}
export function datetime(v) {
  if (!v) return "";
  const d = new Date(v);
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function time(v) {
  if (!v) return "";
  return new Date(v).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
}

/** Converte testo italiano ("1.234,5") in stringa numerica per l'API ("1234.5"). */
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/€|\s/g, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d*\.?\d*$/.test(t) || t === "-" || t === ".") return NaN;
  return t;
}
/** Numero (o stringa API) → testo italiano modificabile. */
export function toInput(v) {
  if (v === null || v === undefined || v === "") return "";
  return String(v).replace(".", ",");
}

// Date di riferimento nel fuso Europe/Rome
export function todayISO() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}
export function nowLocalInput() {
  const d = new Date();
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(" ", "T");
}
export function monthStart(iso = todayISO()) { return iso.slice(0, 8) + "01"; }
export function monthEnd(iso = todayISO()) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function addMonths(iso, n) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
export const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
export function monthLabel(iso) { const [y, m] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }
export function shortMonth(iso) { const [y, m] = String(iso).split("-").map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${String(y).slice(2)}`; }

export const KIND_LABELS = {
  materia_prima: "Materia prima", semilavorato: "Semilavorato", confezione: "Confezione",
  rivendita: "Rivendita", consumabile: "Consumabile",
};
export const STATUS_LABELS = { da_pagare: "Da pagare", parziale: "Parziale", pagata: "Pagata" };
export const PL_GROUPS = {
  materie_prime: "Materie prime", costi_variabili: "Costi variabili", costi_fissi: "Costi fissi",
  personale: "Personale", altri_operativi: "Altri costi operativi", oneri_finanziari: "Oneri finanziari",
  imposte: "Imposte e tributi", investimenti: "Investimenti", non_economica: "Non economica (esclusa)",
  altri_ricavi: "Altri ricavi", altre_componenti: "Altre componenti",
};
