// Client API: cookie di sessione sul web, token Bearer nell'app mobile (Capacitor).
// Nell'app mobile (Capacitor) le pagine sono incluse nell'app e l'API è sul server indicato in config.js
const NATIVE = typeof window !== "undefined" && (!!window.Capacitor?.isNativePlatform?.() || !!window.ISA_API_BASE);
export const API_BASE = (window.ISA_API_BASE || "") + "/api";
const TOKEN_KEY = "isa_token";

function getToken() {
  if (!NATIVE) return null;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  if (!NATIVE) return;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* */ }
}

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, path, body, opts = {}) {
  const headers = { "X-Requested-With": "IsaManager" };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: payload, credentials: "include" });
  } catch {
    throw new ApiError(0, "Connessione assente: controlla la rete e riprova. Nulla è stato salvato.");
  }
  if (opts.raw) {
    if (!res.ok) {
      let msg = "Download non riuscito";
      try { msg = (await res.json()).error || msg; } catch { /* */ }
      throw new ApiError(res.status, msg);
    }
    return res;
  }
  let data = null;
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Errore ${res.status}`, data?.details);
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  put: (p, b) => request("PUT", p, b ?? {}),
  del: (p) => request("DELETE", p),
  upload: (p, form) => request("POST", p, form),
  async download(path, fallbackName) {
    const res = await request("GET", path, undefined, { raw: true });
    const blob = await res.blob();
    const cd = res.headers.get("content-disposition") || "";
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
  async openFile(path) {
    const res = await request("GET", path, undefined, { raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};

export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : "";
}
