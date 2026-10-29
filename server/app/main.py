"""Applicazione web Isaa Rolls Manager (ASGI).

Avvio in sviluppo:   uvicorn app.main:app --reload
Avvio in produzione: uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
"""
import logging
import os
import threading
import time

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import config, db, security
from .http import ROUTES, make_endpoint

# registrazione delle rotte (import per effetto collaterale)
from .api import auth, users, settings, inventory, products, sales, payments, expenses, purchasing, reports, io, giveaways, site  # noqa: F401,E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("isa")

CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'self'; form-action 'self'; object-src 'none'")
# sito pubblico: mappa Leaflet (unpkg) con mappe CARTO/OpenStreetMap
CSP_SITE = ("default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://unpkg.com; script-src 'self' https://unpkg.com; font-src 'self'; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


def _is_site_path(path: str) -> bool:
    """Tutto ciò che non è gestionale o API è il sito pubblico."""
    return not (path.startswith("/gestionale") or path.startswith("/assets/") or path.startswith("/api/"))


class SecurityHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                existing = {k.lower() for k, _ in headers}

                def add(k, v):
                    if k.encode() not in existing:
                        headers.append((k.encode(), v.encode()))
                add("x-content-type-options", "nosniff")
                add("x-frame-options", "DENY")
                site = _is_site_path(scope.get("path", ""))
                # il sito invia l'origine alle mappe di OpenStreetMap (richiesto dalle loro regole d'uso)
                add("referrer-policy", "strict-origin-when-cross-origin" if site else "same-origin")
                add("permissions-policy", "camera=(self), microphone=(), geolocation=(self)")
                if config.IS_PROD:
                    add("strict-transport-security", "max-age=31536000; includeSubDomains")
                path = scope.get("path", "")
                if path.startswith("/api/"):
                    add("cache-control", "no-store")
                elif _is_site_path(path):
                    add("content-security-policy", CSP_SITE)
                else:
                    add("content-security-policy", CSP)
            await send(message)

        # in produzione rifiuta HTTP in chiaro (dietro proxy: X-Forwarded-Proto)
        if config.IS_PROD:
            hdrs = dict(scope.get("headers") or [])
            proto = hdrs.get(b"x-forwarded-proto", b"https").decode()
            if proto == "http" and scope.get("path") != "/healthz":
                host = hdrs.get(b"host", b"").decode()
                from starlette.responses import RedirectResponse
                resp = RedirectResponse(f"https://{host}{scope.get('path', '/')}", status_code=301)
                return await resp(scope, receive, send)
        return await self.app(scope, receive, send_wrapper)


def health(request):
    """Controllo di Render: il programma risponde. Lo stato del database è indicato a parte, così se il database
    ha un problema Render non blocca l'aggiornamento e il sito pubblico resta online."""
    try:
        with db.tx() as c:
            c.val("SELECT 1")
        return JSONResponse({"status": "ok", "db": "ok", "env": config.APP_ENV})
    except Exception:
        return JSONResponse({"status": "ok", "db": "error", "env": config.APP_ENV})


def openapi(request):
    paths: dict = {}
    for method, path, fn, perm, auth_, _ in ROUTES:
        op = {
            "summary": (fn.__doc__ or fn.__name__).strip().split("\n")[0],
            "operationId": fn.__name__,
            "tags": [fn.__module__.split(".")[-1]],
            "security": [{"bearerAuth": []}, {"cookieAuth": []}] if auth_ else [],
            "x-permission": perm,
            "responses": {"200": {"description": "OK"}, "401": {"description": "Non autenticato"},
                          "403": {"description": "Permesso negato"}, "422": {"description": "Dati non validi"}},
        }
        params = [p.strip("{}") for p in path.split("/") if p.startswith("{")]
        if params:
            op["parameters"] = [{"name": p.split("}")[0], "in": "path", "required": True, "schema": {"type": "string"}} for p in params]
        paths.setdefault(path, {})[method.lower()] = op
    return JSONResponse({
        "openapi": "3.0.3",
        "info": {"title": "Isaa Rolls Manager API", "version": "1.0.0",
                 "description": "API del gestionale. Autenticazione: cookie di sessione (web) oppure header "
                                "'Authorization: Bearer <token>' (app mobile). Le richieste con cookie che modificano dati "
                                "devono includere l'header 'X-Requested-With: IsaManager'."},
        "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"},
                                           "cookieAuth": {"type": "apiKey", "in": "cookie", "name": "isa_session"}}},
        "paths": paths,
    })


def api_docs(request):
    rows = "".join(
        f"<tr><td><code>{m}</code></td><td><code>{p}</code></td><td>{(fn.__doc__ or '').strip().split(chr(10))[0]}</td>"
        f"<td><code>{perm if isinstance(perm, str) else ' / '.join(perm or []) or ('pubblica' if not a else 'utente autenticato')}</code></td></tr>"
        for m, p, fn, perm, a, _ in sorted(ROUTES, key=lambda r: (r[1], r[0])))
    return HTMLResponse(f"""<!doctype html><meta charset=utf-8><title>Isaa Rolls Manager API</title>
<style>body{{font:14px system-ui;margin:24px;color:#222}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left}}code{{font-size:12px}}</style>
<h1>Isaa Rolls Manager – API</h1><p>Specifica OpenAPI: <a href="/api/openapi.json">/api/openapi.json</a>. Ogni rotta verifica il permesso indicato lato server.</p>
<table><tr><th>Metodo</th><th>Percorso</th><th>Descrizione</th><th>Permesso</th></tr>{rows}</table>""")


SITE_PAGES = {"": "index.html", "index.html": "index.html", "eventi": "eventi.html", "eventi.html": "eventi.html",
              "privacy": "privacy.html", "privacy.html": "privacy.html",
              "en": "en/index.html", "en/index.html": "en/index.html", "en/eventi": "en/eventi.html", "en/eventi.html": "en/eventi.html",
              "en/privacy": "en/privacy.html", "en/privacy.html": "en/privacy.html"}


def _site_file(rest: str):
    """File del sito pubblico (web/public/sito → dist/sito), servito alla radice del dominio."""
    base = os.path.realpath(os.path.join(config.WEB_DIST, "sito"))
    rest = rest.strip("/")
    name = SITE_PAGES.get(rest, rest)
    fp = os.path.realpath(os.path.join(base, name))
    if not fp.startswith(base + os.sep) or not os.path.isfile(fp):
        # file del gestionale rimasti alla radice (vecchi collegamenti, icona sulla schermata Home)
        if rest and "/" not in rest and not rest.startswith("."):
            g = os.path.realpath(os.path.join(config.WEB_DIST, rest))
            if g.startswith(os.path.realpath(config.WEB_DIST) + os.sep) and os.path.isfile(g) and not g.endswith("index.html"):
                return FileResponse(g, headers={"Cache-Control": "no-cache"})
        fp = os.path.join(base, "index.html")
        if not os.path.isfile(fp):
            return PlainTextResponse("Pagina non trovata", status_code=404)
        return FileResponse(fp, status_code=200 if rest in SITE_PAGES else 404, headers={"Cache-Control": "no-cache"})
    cache = "no-cache" if fp.endswith((".html", ".js", ".css")) else "public, max-age=86400"
    return FileResponse(fp, headers={"Cache-Control": cache})


def site_root(request):
    """Radice del dominio: il sito per i clienti. Chi ha già fatto l'accesso al gestionale viene portato lì."""
    rest = request.path_params.get("rest", "")
    if rest in ("", "index.html") and request.cookies.get(security.COOKIE_NAME):
        try:
            user, _, _ = security.authenticate(request)
        except Exception:
            user = None
        if user:
            return RedirectResponse("/gestionale/", status_code=302)
    return _site_file(rest)


def legacy_sito(request):
    return RedirectResponse("/" + request.path_params.get("rest", ""), status_code=301)


def gestionale(request):
    """Il gestionale, su /gestionale/ (app a pagina singola con i suoi file)."""
    rest = request.path_params.get("rest", "").strip("/")
    base = os.path.realpath(config.WEB_DIST)
    if rest and not rest.startswith(".") and not rest.startswith("sito"):
        fp = os.path.realpath(os.path.join(base, rest))
        if fp.startswith(base + os.sep) and os.path.isfile(fp) and not fp.endswith("index.html"):
            cache = "public, max-age=31536000, immutable" if rest.startswith("assets/") else "no-cache"
            return FileResponse(fp, headers={"Cache-Control": cache})
    index = os.path.join(base, "index.html")
    if not os.path.exists(index):
        return PlainTextResponse("Interfaccia non compilata: eseguire la build del frontend (web/build.mjs).", status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


def _background():
    """Attività periodiche: spese ricorrenti, pulizia sessioni scadute."""
    from .services import expenses
    time.sleep(5)
    while True:
        try:
            with db.tx() as c:
                n = expenses.generate_recurring(c)
                c.exec("DELETE FROM sessions WHERE expires_at < now() - interval '30 days'")
                c.exec("DELETE FROM login_attempts WHERE at < now() - interval '90 days'")
                if n:
                    log.info("Generate %s scadenze da spese ricorrenti", n)
        except Exception as e:  # pragma: no cover
            log.warning("Attività periodica non riuscita: %s", e)
        time.sleep(3600)


def _migrate_with_retry():
    """Aggiorna il database all'avvio. Se il database non risponde (rete, manutenzione di Neon)
    il programma non si ferma: il sito resta online e si riprova finché il database torna raggiungibile."""
    from .migrate import migrate
    delay = 2
    for attempt in range(1, 5):                     # circa 20 secondi di tentativi, poi si parte comunque
        try:
            migrate(verbose=True)
            return True
        except Exception as e:
            log.warning("Database non raggiungibile all'avvio (tentativo %s): %s", attempt, str(e)[:1500])
            db.reset_pool()
            time.sleep(delay)
            delay = min(delay * 2, 15)

    def keep_trying():
        while True:
            time.sleep(30)
            try:
                migrate(verbose=True)
                log.warning("Database di nuovo raggiungibile: aggiornamento completato")
                return
            except Exception as e:
                log.warning("Database ancora non raggiungibile: %s", str(e)[:1500])
                db.reset_pool()
    threading.Thread(target=keep_trying, daemon=True).start()
    return False


def on_startup():
    if os.environ.get("AUTO_MIGRATE", "1") == "1":
        _migrate_with_retry()
    if os.environ.get("BACKGROUND_JOBS", "1") == "1":
        threading.Thread(target=_background, daemon=True).start()


routes = [Route(p, make_endpoint(fn, perm, a, raw), methods=[m]) for m, p, fn, perm, a, raw in ROUTES]
routes += [
    Route("/healthz", health),
    Route("/api/openapi.json", openapi),
    Route("/api/docs", api_docs),
]
if os.path.isdir(config.WEB_DIST):
    routes.append(Mount("/assets", StaticFiles(directory=os.path.join(config.WEB_DIST, "assets"), check_dir=False), name="assets"))


async def _api_404(request):
    return JSONResponse({"error": "Risorsa non trovata"}, status_code=404)

routes.append(Route("/api/{rest:path}", _api_404, methods=["GET", "POST", "PUT", "DELETE", "PATCH"]))
routes.append(Route("/gestionale", lambda r: RedirectResponse("/gestionale/", status_code=308)))
routes.append(Route("/gestionale/{rest:path}", gestionale))
routes.append(Route("/sito", lambda r: RedirectResponse("/", status_code=301)))
routes.append(Route("/sito/{rest:path}", legacy_sito))
routes.append(Route("/{rest:path}", site_root))

middleware = [
    Middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
               allow_methods=["GET", "POST", "PUT", "DELETE"],
               allow_headers=["Authorization", "Content-Type", "X-Requested-With"]),
    Middleware(SecurityHeaders),
]

from contextlib import asynccontextmanager  # noqa: E402


@asynccontextmanager
async def lifespan(app):
    on_startup()
    yield
    db.reset_pool()


app = Starlette(routes=routes, middleware=middleware, lifespan=lifespan)
