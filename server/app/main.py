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
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import config, db
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


def _is_site_host(scope) -> bool:
    if not config.SITE_HOSTS:
        return False
    host = dict(scope.get("headers") or []).get(b"host", b"").decode().split(":")[0].lower()
    return host in config.SITE_HOSTS


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
                site = scope.get("path", "").startswith("/sito") or _is_site_host(scope)
                # il sito invia l'origine alle mappe di OpenStreetMap (richiesto dalle loro regole d'uso)
                add("referrer-policy", "strict-origin-when-cross-origin" if site else "same-origin")
                add("permissions-policy", "camera=(self), microphone=(), geolocation=(self)")
                if config.IS_PROD:
                    add("strict-transport-security", "max-age=31536000; includeSubDomains")
                path = scope.get("path", "")
                if path.startswith("/api/"):
                    add("cache-control", "no-store")
                elif path.startswith("/sito") or _is_site_host(scope):
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
    try:
        with db.tx() as c:
            c.val("SELECT 1")
        return JSONResponse({"status": "ok", "env": config.APP_ENV})
    except Exception:
        return JSONResponse({"status": "db_error"}, status_code=503)


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
              "privacy": "privacy.html", "privacy.html": "privacy.html"}


def _site_file(rest: str):
    """File del sito pubblico (web/public/sito → dist/sito)."""
    base = os.path.realpath(os.path.join(config.WEB_DIST, "sito"))
    rest = rest.strip("/")
    name = SITE_PAGES.get(rest, rest)
    fp = os.path.realpath(os.path.join(base, name))
    if not fp.startswith(base + os.sep) or not os.path.isfile(fp):
        fp = os.path.join(base, "index.html") if rest in SITE_PAGES else None
    if not fp or not os.path.isfile(fp):
        return PlainTextResponse("Pagina non trovata", status_code=404)
    cache = "no-cache" if fp.endswith((".html", ".js", ".css")) else "public, max-age=86400"
    return FileResponse(fp, headers={"Cache-Control": cache})


def site_page(request):
    return _site_file(request.path_params.get("rest", ""))


def _spa_index(request):
    if _is_site_host(request.scope):
        return _site_file(request.path_params.get("rest", ""))
    rest = request.path_params.get("rest", "")
    if rest and "/" not in rest and not rest.startswith("."):
        base = os.path.realpath(config.WEB_DIST)
        fp = os.path.realpath(os.path.join(base, rest))
        if fp.startswith(base + os.sep) and os.path.isfile(fp):
            return FileResponse(fp, headers={"Cache-Control": "public, max-age=3600"})
    index = os.path.join(config.WEB_DIST, "index.html")
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


def on_startup():
    if os.environ.get("AUTO_MIGRATE", "1") == "1":
        from .migrate import migrate
        migrate(verbose=True)
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
from starlette.responses import RedirectResponse  # noqa: E402
routes.append(Route("/sito", lambda r: RedirectResponse("/sito/", status_code=308)))
routes.append(Route("/sito/{rest:path}", site_page))
routes.append(Route("/{rest:path}", _spa_index))

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
