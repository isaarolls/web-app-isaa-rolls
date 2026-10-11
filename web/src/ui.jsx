import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LuX, LuSearch, LuChevronDown, LuChevronUp, LuInbox, LuTriangleAlert, LuLoaderCircle, LuCheck } from "react-icons/lu";
import { api, ApiError } from "./api.js";
import * as F from "./fmt.js";

// ------------------------------------------------------------------ contesto applicazione
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ------------------------------------------------------------------ router (hash)
function parseHash() {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [path, q = ""] = h.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(q)) };
}
export function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const f = () => setR(parseHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return r;
}
export function navigate(path) { window.location.hash = path; }
export function Link({ to, children, className, ...rest }) {
  return <a href={`#${to}`} className={className} {...rest}>{children}</a>;
}

// ------------------------------------------------------------------ dati
export function useData(path, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) { setState({ data: null, error: null, loading: false }); return; }
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path).then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error) => n === seq.current && setState({ data: null, error, loading: false }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Esegue un'azione mostrando l'esito; restituisce il risultato o null. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, "ok");
      return r ?? true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Operazione non riuscita", "error", e?.details);
      return null;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

// ------------------------------------------------------------------ elementi base
export function Button({ variant = "default", icon: Icon, children, busy, className = "", size, ...rest }) {
  return (
    <button className={`btn btn-${variant} ${size ? "btn-" + size : ""} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <LuLoaderCircle className="spin" /> : Icon ? <Icon aria-hidden /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, hint, error, children, className = "", required }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req" aria-hidden> *</span>}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export const Input = React.forwardRef(function Input(props, ref) { return <input ref={ref} className="input" {...props} />; });
export function Textarea(props) { return <textarea className="input" rows={3} {...props} />; }

/** Campo numerico con virgola decimale. value/onChange lavorano con testo in formato italiano. */
export function NumInput({ value, onChange, suffix, ...rest }) {
  const invalid = value !== "" && value !== null && value !== undefined && Number.isNaN(F.parseNum(value));
  return (
    <span className={`num-wrap ${invalid ? "invalid" : ""}`}>
      <input className="input num" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid} {...rest} />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <span className="select-wrap">
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <LuChevronDown className="select-icon" aria-hidden />
    </span>
  );
}

export function Check({ checked, onChange, label, hint }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden><LuCheck /></span>
      <span><span>{label}</span>{hint && <span className="field-hint block">{hint}</span>}</span>
    </label>
  );
}

/** Selezione con ricerca (articoli, prodotti, fornitori...). */
export function Combo({ options, value, onChange, placeholder = "Cerca…", autoFocus }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const sel = options.find((o) => String(o.value) === String(value));
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = t ? options.filter((o) => (o.label + " " + (o.sub || "")).toLowerCase().includes(t)) : options;
    return r.slice(0, 60);
  }, [q, options]);
  const pick = (o) => { onChange(o.value, o); setOpen(false); setQ(""); };
  return (
    <div className="combo" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <input className="input" autoFocus={autoFocus} placeholder={sel ? sel.label : placeholder}
        value={open ? q : sel ? sel.label : ""} onFocus={() => { setOpen(true); setHi(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { setHi((h) => Math.min(h + 1, list.length - 1)); e.preventDefault(); }
          if (e.key === "ArrowUp") { setHi((h) => Math.max(h - 1, 0)); e.preventDefault(); }
          if (e.key === "Enter" && open && list[hi]) { pick(list[hi]); e.preventDefault(); }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && (
        <ul className="combo-list" role="listbox">
          {list.length === 0 && <li className="combo-empty">Nessun risultato</li>}
          {list.map((o, i) => (
            <li key={o.value} role="option" aria-selected={i === hi} tabIndex={-1}
              className={i === hi ? "hi" : ""} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              <span>{o.label}</span>{o.sub && <span className="combo-sub">{o.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Badge({ tone = "neutral", children }) { return <span className={`badge badge-${tone}`}>{children}</span>; }

export function Modal({ title, onClose, children, footer, size = "md" }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const k = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", k);
    document.body.classList.add("modal-open");
    setTimeout(() => ref.current?.querySelector("input,select,textarea,button:not(.modal-x)")?.focus(), 30);
    return () => { document.removeEventListener("keydown", k); document.body.classList.remove("modal-open"); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Chiudi"><LuX /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Richiede il motivo di un annullamento/storno. */
export function ReasonModal({ title, message, confirmLabel = "Conferma", onConfirm, onClose, danger = true }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 3) return;
    setBusy(true);
    const ok = await onConfirm(reason.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={title} onClose={onClose} size="sm" footer={<>
      <Button onClick={onClose}>Indietro</Button>
      <Button variant={danger ? "danger" : "primary"} busy={busy} disabled={reason.trim().length < 3} onClick={submit}>{confirmLabel}</Button>
    </>}>
      {message && <p className="muted">{message}</p>}
      <Field label="Motivo" hint="Resterà nello storico delle operazioni" required>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      </Field>
    </Modal>
  );
}

export function ConfirmModal({ title, message, confirmLabel = "Conferma", onConfirm, onClose, danger }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} size="sm" footer={<>
      <Button onClick={onClose}>Annulla</Button>
      <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={async () => { setBusy(true); const ok = await onConfirm(); setBusy(false); if (ok) onClose(); }}>{confirmLabel}</Button>
    </>}>
      <p>{message}</p>
    </Modal>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter(Boolean).map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={value === t.value ? "on" : ""}
          onClick={() => onChange(t.value)}>{t.label}{t.count !== undefined && <span className="tab-count">{t.count}</span>}</button>
      ))}
    </div>
  );
}

export function PageHeader({ title, sub, actions, back }) {
  return (
    <div className="page-head">
      <div>
        {back && <Link to={back.to} className="back-link">← {back.label}</Link>}
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <LuInbox aria-hidden />
      <p className="empty-title">{title}</p>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "Caricamento…" }) {
  return <div className="loading"><LuLoaderCircle className="spin" /> {label}</div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      <LuTriangleAlert /> <span>{error.message || String(error)}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Riprova</Button>}
    </div>
  );
}

export function Notice({ tone = "info", children }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/** Valore principale cliccabile per vedere le operazioni che lo compongono. */
export function Stat({ label, value, sub, onClick, tone, delta, deltaInverse }) {
  const Tag = onClick ? "button" : "div";
  let deltaEl = null;
  if (delta && delta.pct !== null && delta.pct !== undefined) {
    const up = Number(delta.diff) >= 0;
    const good = deltaInverse ? !up : up;
    deltaEl = <span className={`delta ${good ? "good" : "bad"}`}>{up ? "▲" : "▼"} {F.pct(Math.abs(delta.pct))}</span>;
  }
  return (
    <Tag className={`stat ${onClick ? "clickable" : ""} ${tone ? "stat-" + tone : ""}`} onClick={onClick}
      title={onClick ? "Clicca per vedere le operazioni" : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {(sub || deltaEl) && <span className="stat-sub">{deltaEl} {sub}</span>}
    </Tag>
  );
}

// ------------------------------------------------------------------ tabella con ricerca e ordinamento
export function DataTable({ columns, rows, onRowClick, empty = "Nessun dato", search = true, searchPlaceholder = "Cerca…",
  footer, rowClass, initialSort, pageSize = 100, toolbar }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(initialSort || null);
  const [limit, setLimit] = useState(pageSize);
  const filtered = useMemo(() => {
    let r = rows || [];
    const t = q.trim().toLowerCase();
    if (t) {
      r = r.filter((row) => columns.some((c) => {
        const v = c.searchValue ? c.searchValue(row) : row[c.key];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(t);
      }));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (row) => (col?.sortValue ? col.sortValue(row) : row[sort.key]);
      r = [...r].sort((a, b) => {
        const x = val(a), y = val(b);
        const nx = Number(x), ny = Number(y);
        const cmp = x === null || x === undefined ? 1 : y === null || y === undefined ? -1
          : !Number.isNaN(nx) && !Number.isNaN(ny) && x !== "" && y !== "" ? nx - ny : String(x).localeCompare(String(y), "it");
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return r;
  }, [rows, q, sort, columns]);
  const cell = (c, row) => {
    if (c.render) return c.render(row);
    const v = row[c.key];
    switch (c.type) {
      case "money": return F.eur(v);
      case "money4": return F.eur4(v);
      case "number": return F.num(v);
      case "date": return F.date(v);
      case "datetime": return F.datetime(v);
      case "pct": return F.pct(v);
      case "bool": return v ? "Sì" : "No";
      default: return v ?? "";
    }
  };
  const right = (c) => c.align === "right" || ["money", "money4", "number", "pct"].includes(c.type);
  return (
    <div className="table-block">
      {(search || toolbar) && (
        <div className="table-tools">
          {search && (
            <div className="search">
              <LuSearch aria-hidden />
              <input className="input" placeholder={searchPlaceholder} value={q} onChange={(e) => { setQ(e.target.value); setLimit(pageSize); }}
                aria-label="Cerca nella tabella" />
            </div>
          )}
          {toolbar}
          <span className="table-count">{filtered.length} {filtered.length === 1 ? "riga" : "righe"}</span>
        </div>
      )}
      {filtered.length === 0 ? <Empty title={q ? "Nessun risultato per la ricerca" : empty} /> : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={right(c) ? "r" : ""} style={c.width ? { width: c.width } : undefined}>
                    {c.sortable === false ? c.label : (
                      <button className="th-sort" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: right(c) ? "desc" : "asc" }))}>
                        {c.label}{sort?.key === c.key && (sort.dir === "asc" ? <LuChevronUp /> : <LuChevronDown />)}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((row, i) => (
                <tr key={row.id ?? i} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${onRowClick ? "clickable" : ""} ${rowClass ? rowClass(row) : ""}`}
                  tabIndex={onRowClick ? 0 : undefined} onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(row) : undefined}>
                  {columns.map((c) => <td key={c.key} className={`${right(c) ? "r num-cell" : ""} ${c.className || ""}`} data-label={c.label}>{cell(c, row)}</td>)}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot>{footer(filtered)}</tfoot>}
          </table>
          {filtered.length > limit && (
            <div className="more"><Button size="sm" onClick={() => setLimit((l) => l + pageSize * 2)}>Mostra altre righe ({filtered.length - limit})</Button></div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ periodo
export function rangePresets() {
  const t = F.todayISO();
  const dow = (new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7;
  const pm = F.addMonths(F.monthStart(t), -1);
  return [
    { key: "oggi", label: "Oggi", from: t, to: t },
    { key: "ieri", label: "Ieri", from: F.addDays(t, -1), to: F.addDays(t, -1) },
    { key: "settimana", label: "Questa settimana", from: F.addDays(t, -dow), to: t },
    { key: "mese", label: "Questo mese", from: F.monthStart(t), to: t },
    { key: "mese_scorso", label: "Mese scorso", from: pm, to: F.monthEnd(pm) },
    { key: "anno", label: "Quest'anno", from: t.slice(0, 4) + "-01-01", to: t },
    { key: "12m", label: "Ultimi 12 mesi", from: F.addMonths(F.monthStart(t), -11), to: t },
  ];
}

export function DateRange({ from, to, onChange, compact }) {
  const presets = rangePresets();
  const current = presets.find((p) => p.from === from && p.to === to)?.key || "custom";
  return (
    <div className={`range ${compact ? "compact" : ""}`}>
      <Select value={current} onChange={(k) => { const p = presets.find((x) => x.key === k); if (p) onChange(p.from, p.to); }}
        options={[...presets.map((p) => ({ value: p.key, label: p.label })), { value: "custom", label: "Personalizzato" }]} aria-label="Periodo" />
      <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} aria-label="Dal" />
      <span className="range-sep">–</span>
      <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} aria-label="Al" />
    </div>
  );
}

/** Stato del periodo salvato nell'URL (così si può condividere/ricaricare). */
export function useRangeState(defaultKey = "mese") {
  const { query } = useRoute();
  const p = rangePresets().find((x) => x.key === defaultKey);
  const [r, setR] = useState({ from: query.from || p.from, to: query.to || p.to });
  return [r.from, r.to, (from, to) => setR({ from, to })];
}

// ------------------------------------------------------------------ toast
export function Toasts({ items, dismiss }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role={t.type === "error" ? "alert" : "status"}>
          <div>
            <div>{t.msg}</div>
            {Array.isArray(t.details) && t.details.length > 1 && (
              <ul className="toast-details">{t.details.slice(0, 6).map((d, i) => <li key={i}>{d.message || String(d)}</li>)}</ul>
            )}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Chiudi"><LuX /></button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ form helper
export function useForm(initial) {
  const [v, setV] = useState(initial);
  const set = useCallback((k) => (val) => setV((s) => ({ ...s, [k]: val?.target ? (val.target.type === "checkbox" ? val.target.checked : val.target.value) : val })), []);
  return [v, set, setV];
}

/** Converte i campi numerici del form (testo italiano) in stringhe per l'API. */
export function nums(obj, keys) {
  const out = { ...obj };
  for (const k of keys) {
    const p = F.parseNum(out[k]);
    out[k] = p === null || Number.isNaN(p) ? (out[k] === "" ? null : out[k]) : p;
  }
  return out;
}
