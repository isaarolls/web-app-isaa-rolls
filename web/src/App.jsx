import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuLayoutDashboard, LuShoppingBag, LuReceipt, LuWallet, LuPackage, LuCookie, LuCreditCard, LuTruck,
  LuClipboardList, LuChartColumn, LuUsers, LuSettings, LuLogOut, LuMenu, LuEllipsis, LuKeyRound, LuLock, LuBike, LuPartyPopper,
} from "react-icons/lu";
import { api, setToken, setUnauthorizedHandler } from "./api.js";
import { AppCtx, Toasts, useRoute, navigate, Loading, Link } from "./ui.jsx";
import { DrillModal } from "./pages/Drill.jsx";
import { Login, ResetPassword, ChangePassword } from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import { Pos } from "./pages/Pos.jsx";
import { SalesList, SaleDetail, DayClose } from "./pages/Sales.jsx";
import { Payments } from "./pages/Payments.jsx";
import { Inventory, ItemDetail, CountPage } from "./pages/Inventory.jsx";
import { Products, ProductEditor } from "./pages/Products.jsx";
import { Expenses, ExpenseDetail } from "./pages/Expenses.jsx";
import { Suppliers, SupplierDetail } from "./pages/Suppliers.jsx";
import { Orders, OrderDetail, ReceiveGoods } from "./pages/Orders.jsx";
import { Reports } from "./pages/Reports.jsx";
import { Users } from "./pages/Users.jsx";
import { BikeLocation, EventRequests } from "./pages/Site.jsx";
import { Settings } from "./pages/Settings.jsx";

const NAV = [
  { to: "/", label: "Dashboard", icon: LuLayoutDashboard, perm: "dashboard.view" },
  { to: "/cassa", label: "Vendi", icon: LuShoppingBag, perm: "sales.create" },
  { to: "/vendite", label: "Vendite", icon: LuReceipt, perm: "sales.view" },
  { to: "/chiusura", label: "Chiusura di cassa", icon: LuLock, perm: "sales.close_day" },
  { to: "/incassi", label: "Incassi", icon: LuWallet, perm: "payments.view" },
  { group: "Magazzino e prodotti" },
  { to: "/magazzino", label: "Magazzino", icon: LuPackage, perm: "inventory.view" },
  { to: "/prodotti", label: "Prodotti e ricette", icon: LuCookie, perm: "products.view" },
  { group: "Acquisti e costi" },
  { to: "/spese", label: "Spese", icon: LuCreditCard, perm: "expenses.view" },
  { to: "/fornitori", label: "Fornitori", icon: LuTruck, perm: "suppliers.view" },
  { to: "/ordini", label: "Ordini", icon: LuClipboardList, perm: "purchasing.view" },
  { group: "Analisi" },
  { to: "/report", label: "Report mensili", icon: LuChartColumn, perm: "reports.view" },
  { group: "Sito e bici" },
  { to: "/bici", label: "Posizione bici", icon: LuBike, perm: "location.share" },
  { to: "/eventi", label: "Richieste eventi", icon: LuPartyPopper, perm: "events.view" },
  { group: "Amministrazione" },
  { to: "/utenti", label: "Utenti e permessi", icon: LuUsers, perm: ["users.manage", "audit.view"] },
  { to: "/impostazioni", label: "Impostazioni", icon: LuSettings, perm: ["settings.manage", "import.run", "export.run", "periods.close"] },
];

const ROUTES = [
  ["/", Dashboard], ["/cassa", Pos], ["/vendite", SalesList], ["/vendite/:id", SaleDetail], ["/chiusura", DayClose],
  ["/incassi", Payments], ["/magazzino", Inventory], ["/magazzino/:id", ItemDetail], ["/inventario/:id", CountPage],
  ["/prodotti", Products], ["/prodotti/:id", ProductEditor], ["/spese", Expenses], ["/spese/:id", ExpenseDetail],
  ["/fornitori", Suppliers], ["/fornitori/:id", SupplierDetail], ["/ordini", Orders], ["/ordini/:id", OrderDetail],
  ["/ricevimento", ReceiveGoods], ["/report", Reports], ["/utenti", Users], ["/impostazioni", Settings],
  ["/cambia-password", ChangePassword], ["/bici", BikeLocation], ["/eventi", EventRequests],
];

function match(pattern, path) {
  const a = pattern.split("/").filter(Boolean), b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

function allowed(perm, can) { return !perm || (Array.isArray(perm) ? perm.some(can) : can(perm)); }

export default function App() {
  const [me, setMe] = useState(undefined);
  const [toasts, setToasts] = useState([]);
  const [drill, setDrill] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const route = useRoute();
  const tid = useRef(0);

  const loadMe = useCallback(() => api.get("/auth/me").then(setMe, () => setMe(null)), []);
  useEffect(() => { loadMe(); setUnauthorizedHandler(() => setMe(null)); }, [loadMe]);
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0); }, [route.path]);
  // aggiornamento automatico: se è stata pubblicata una nuova versione, la carica
  const [newVersion, setNewVersion] = useState(false);
  useEffect(() => {
    const mine = (document.querySelector('script[src*="app.js"]')?.getAttribute("src") || "").split("v=")[1];
    if (!mine) return;
    const check = async (reloadNow) => {
      try {
        const html = await (await fetch("index.html", { cache: "no-store" })).text();
        const live = (html.match(/app\.js\?v=([0-9a-f]+)/) || [])[1];
        if (live && live !== mine) { if (reloadNow) window.location.reload(); else setNewVersion(true); }
      } catch { /* offline: riprova più tardi */ }
    };
    const onVis = () => { if (document.visibilityState === "visible") check(true); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => check(false), 5 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, []);

  const toast = useCallback((msg, type = "info", details) => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, type, details }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 8000 : 3500);
  }, []);

  const ctx = useMemo(() => {
    const perms = new Set(me?.permissions || []);
    return {
      me, user: me?.user, settings: me?.settings || {}, can: (p) => perms.has(p), toast, reloadMe: loadMe,
      openDrill: (metric, from, to, title) => setDrill({ metric, from, to, title }),
      logout: async () => { try { await api.post("/auth/logout"); } catch { /* */ } setToken(null); setMe(null); navigate("/"); },
    };
  }, [me, toast, loadMe]);

  if (route.path.startsWith("/reimposta-password")) {
    return <AppCtx.Provider value={ctx}><ResetPassword token={route.query.token} /><Toasts items={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} /></AppCtx.Provider>;
  }
  if (me === undefined) return <Loading label="Avvio di Isaa Rolls Manager…" />;
  if (!me) {
    return <AppCtx.Provider value={ctx}><Login onLogin={loadMe} /><Toasts items={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} /></AppCtx.Provider>;
  }

  let Page = null, params = {};
  if (me.user.must_change_password) Page = ChangePassword;
  else if (route.path === "/" && !ctx.can("dashboard.view")) Page = Pos;  // il dipendente entra direttamente in cassa
  else for (const [p, C] of ROUTES) { const m = match(p, route.path); if (m) { Page = C; params = m; break; } }
  const navItems = NAV.filter((n) => n.group || allowed(n.perm, ctx.can));
  const visible = navItems.filter((n, i) => !n.group || (navItems[i + 1] && !navItems[i + 1].group));
  const isOn = (to) => (to === "/" ? route.path === "/" : route.path === to || route.path.startsWith(to + "/"));
  const company = me.settings?.company?.name || "Isaa Rolls Manager";
  const tabs = [
    ctx.can("dashboard.view") && { to: "/", label: "Home", icon: LuLayoutDashboard },
    ctx.can("sales.view") && { to: "/vendite", label: "Vendite", icon: LuReceipt },
    ctx.can("sales.create") && { to: ctx.can("dashboard.view") ? "/cassa" : "/", label: "Vendi", icon: LuShoppingBag, sell: true },
    ctx.can("inventory.view") && { to: "/magazzino", label: "Magazzino", icon: LuPackage },
    !ctx.can("sales.view") && ctx.can("sales.close_day") && { to: "/chiusura", label: "Chiusura", icon: LuLock },
    !ctx.can("inventory.view") && ctx.can("location.share") && { to: "/bici", label: "Bici", icon: LuBike },
  ].filter(Boolean).slice(0, 4);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <aside className={`side ${menuOpen ? "open" : ""}`} onClick={(e) => e.target.closest("a") && setMenuOpen(false)}>
          <Link to="/" className="side-brand">
            <img src="logo-240.png" alt="" />
            <span><b>Isaa Rolls Manager</b><small>{company !== "Isaa Rolls" && company !== "Isaa Rolls Manager" ? company : "Gestionale"}</small></span>
          </Link>
          {me.env !== "production" && <div className="env-flag">{me.env === "staging" ? "Ambiente di prova online" : me.env === "test" ? "Ambiente di test" : "Ambiente di sviluppo"}: dati non reali</div>}
          <nav aria-label="Menu principale">
            {visible.map((n, i) => n.group ? <div key={i} className="nav-group">{n.group}</div> : (
              <Link key={n.to} to={n.to} className={isOn(n.to) ? "on" : ""}><n.icon aria-hidden /> {n.label}</Link>
            ))}
          </nav>
          <div className="side-user">
            <div className="who"><b>{me.user.full_name}</b><span>{me.user.role_name}</span></div>
            <Link to="/cambia-password" title="Cambia password" aria-label="Cambia password" className="icon-link"><LuKeyRound /></Link>
            <button onClick={ctx.logout} title="Esci" aria-label="Esci"><LuLogOut /></button>
          </div>
        </aside>
        {menuOpen && <div className="side-backdrop" onClick={() => setMenuOpen(false)} />}
        <div style={{ minWidth: 0 }}>
          {newVersion && <button className="update-bar" onClick={() => window.location.reload()}>È disponibile una nuova versione dell'app: tocca qui per aggiornare</button>}
          <header className="mobile-top">
            <button onClick={() => setMenuOpen(true)} aria-label="Apri menu"><LuMenu /></button>
            <b>Isaa Rolls Manager</b>
            <span style={{ width: 30 }} />
          </header>
          <main className="main">
            {Page ? <Page params={params} query={route.query} key={route.path} /> : (
              <div className="empty"><p className="empty-title">Pagina non trovata</p><Link to="/">Torna alla dashboard</Link></div>
            )}
          </main>
        </div>
        <nav className="tabbar" aria-label="Navigazione rapida">
          {tabs.map((t) => (
            <Link key={t.to} to={t.to} className={`${isOn(t.to) ? "on" : ""} ${t.sell ? "sell" : ""}`}>
              {t.sell ? <span className="dot"><t.icon /></span> : <t.icon />}<span>{t.label}</span>
            </Link>
          ))}
          <button onClick={() => setMenuOpen(true)}><LuEllipsis /><span>Altro</span></button>
        </nav>
      </div>
      {drill && <DrillModal {...drill} onClose={() => setDrill(null)} />}
      <Toasts items={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </AppCtx.Provider>
  );
}
