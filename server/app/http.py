"""Infrastruttura HTTP: registro delle rotte, autenticazione, permessi, errori, JSON."""
from __future__ import annotations

import datetime as dt
import json
import logging
import traceback
from decimal import Decimal
from typing import Any, Callable

from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import db, security
from .pq import DatabaseError

log = logging.getLogger("isa")


class ApiError(Exception):
    def __init__(self, status: int, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.details = details


def not_found(what="Elemento"):
    return ApiError(404, f"{what} non trovato")


def bad(msg, details=None):
    return ApiError(422, msg, details)


def conflict(msg):
    return ApiError(409, msg)


def _default(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (dt.datetime, dt.date)):
        return o.isoformat()
    if isinstance(o, (bytes, memoryview)):
        return None
    if isinstance(o, BaseModel):
        return o.model_dump()
    raise TypeError(f"Tipo non serializzabile: {type(o)}")


class JSON(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, default=_default, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


FIELD_NAMES = {
    "name": "nome", "sku": "codice", "unit_code": "unità di misura", "qty": "quantità",
    "email": "e-mail", "password": "password", "description": "descrizione", "amount": "importo",
    "category_id": "categoria", "doc_date": "data documento", "net_amount": "imponibile",
    "sale_price": "prezzo di vendita", "lines": "righe", "channel_id": "canale",
}


def _validation_details(e: ValidationError):
    out = []
    for err in e.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
        field = FIELD_NAMES.get(loc.split(".")[-1], loc)
        t = err.get("type", "")
        if t == "missing":
            msg = "campo obbligatorio"
        elif "greater_than" in t:
            msg = f"deve essere maggiore di {err.get('ctx', {}).get('gt', err.get('ctx', {}).get('ge', ''))}"
        elif t in ("decimal_parsing", "float_parsing", "int_parsing"):
            msg = "numero non valido"
        elif t.startswith("date") or t.startswith("datetime"):
            msg = "data non valida"
        elif t == "string_too_short":
            msg = "valore troppo corto"
        elif t == "string_too_long":
            msg = "valore troppo lungo"
        else:
            msg = err.get("msg", "valore non valido")
        out.append({"field": loc, "message": f"{field}: {msg}"})
    return out


class Ctx:
    def __init__(self, request: Request, body: Any, user: dict | None, perms: set[str], params: dict):
        self.request = request
        self.body = body
        self.user = user
        self.perms = perms
        self.params = params
        self.query = request.query_params
        self.ip = request.client.host if request.client else None
        self.files: dict = {}
        self.form: dict = {}

    @property
    def uid(self) -> int | None:
        return self.user["id"] if self.user else None

    def can(self, perm: str) -> bool:
        return perm in self.perms

    def require(self, perm: str):
        if perm not in self.perms:
            raise ApiError(403, "Non hai i permessi per questa operazione")

    def parse(self, model: type[BaseModel]):
        try:
            return model.model_validate(self.body if self.body is not None else {})
        except ValidationError as e:
            d = _validation_details(e)
            raise ApiError(422, d[0]["message"] if len(d) == 1 else "Alcuni dati non sono validi", d)

    def q(self, name: str, default=None, cast: Callable | None = None):
        v = self.query.get(name)
        if v in (None, ""):
            return default
        if cast:
            try:
                return cast(v)
            except Exception:
                raise bad(f"Parametro '{name}' non valido")
        return v

    def qdate(self, name: str, default=None) -> dt.date | None:
        return self.q(name, default, lambda s: dt.date.fromisoformat(s))

    def pid(self, name="id") -> int:
        try:
            return int(self.params[name])
        except Exception:
            raise not_found()


ROUTES: list[tuple[str, str, Callable, str | list | None, bool, bool]] = []


def api(method: str, path: str, perm: str | list[str] | None = None, auth: bool = True, raw_body: bool = False):
    """Registra una rotta API. `perm` può essere un permesso o una lista (basta uno)."""
    def deco(fn):
        ROUTES.append((method, "/api" + path, fn, perm, auth, raw_body))
        return fn
    return deco


MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def make_endpoint(fn, perm, auth, raw_body):
    async def endpoint(request: Request):
        try:
            body = None
            files = {}
            form = {}
            ctype = request.headers.get("content-type", "")
            if request.method in MUTATING:
                if ctype.startswith("multipart/form-data"):
                    from . import config
                    f = await request.form(max_part_size=config.MAX_UPLOAD_MB * 1024 * 1024)
                    for k, v in f.multi_items():
                        if hasattr(v, "read"):
                            files[k] = {"filename": v.filename, "content_type": v.content_type, "data": await v.read()}
                        else:
                            form[k] = v
                elif raw_body:
                    body = await request.body()
                else:
                    raw = await request.body()
                    if raw:
                        try:
                            body = json.loads(raw)
                        except Exception:
                            raise bad("Formato dei dati non valido (JSON atteso)")

            user, perms, via_cookie = None, set(), False
            if auth:
                user, perms, via_cookie = await run_in_threadpool(security.authenticate, request)
                if not user:
                    raise ApiError(401, "Sessione scaduta o non valida: accedi di nuovo")
                if via_cookie and request.method in MUTATING and request.headers.get("x-requested-with") != "IsaManager":
                    raise ApiError(403, "Richiesta non consentita (CSRF)")
                if user.get("must_change_password") and fn.__name__ not in ("change_password", "me", "logout"):
                    raise ApiError(403, "Devi cambiare la password prima di continuare")
                if perm:
                    needed = [perm] if isinstance(perm, str) else perm
                    if not any(p in perms for p in needed):
                        raise ApiError(403, "Non hai i permessi per questa operazione")

            ctx = Ctx(request, body, user, perms, dict(request.path_params))
            ctx.files, ctx.form = files, form
            result = await run_in_threadpool(fn, ctx)
            if isinstance(result, Response):
                return result
            return JSON(result if result is not None else {"ok": True})
        except ApiError as e:
            return JSON({"error": e.message, "details": e.details}, status_code=e.status)
        except DatabaseError as e:
            return _db_error(e)
        except Exception:  # pragma: no cover
            log.error("Errore non gestito su %s %s\n%s", request.method, request.url.path, traceback.format_exc())
            return JSON({"error": "Errore interno del server. L'operazione non è stata salvata."}, status_code=500)

    endpoint.__name__ = fn.__name__
    return endpoint


def _db_error(e: DatabaseError):
    st = e.sqlstate or ""
    msg = str(e).split("\n")[0].replace("ERROR:", "").replace("ERRORE:", "").strip()
    if st in ("P0001", "P0002"):
        return JSON({"error": msg}, status_code=409)
    if st == "23505":
        return JSON({"error": "Esiste già un elemento con lo stesso codice o nome"}, status_code=409)
    if st == "23503":
        return JSON({"error": "Operazione non possibile: il dato è collegato ad altre registrazioni o il riferimento non esiste"}, status_code=409)
    if st == "23514":
        return JSON({"error": "Dati non coerenti: verifica importi e quantità", "details": e.constraint}, status_code=422)
    if st == "40001" or st == "40P01":
        return JSON({"error": "Operazione in conflitto con un altro utente: riprova"}, status_code=409)
    log.error("Errore database: %s (%s)", e, st)
    return JSON({"error": "Errore del database. L'operazione non è stata salvata."}, status_code=500)


def audit(c: db.Cursor, ctx: Ctx | None, action: str, entity: str, entity_id, summary: str,
          before: dict | None = None, after: dict | None = None):
    def clean(d):
        if d is None:
            return None
        return json.loads(json.dumps(d, default=_default))
    c.exec(
        "INSERT INTO audit_log(user_id,action,entity,entity_id,summary,before,after,ip) "
        "VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s)",
        [ctx.uid if ctx else None, action, entity, str(entity_id) if entity_id is not None else None, summary,
         json.dumps(clean(before)) if before is not None else None,
         json.dumps(clean(after)) if after is not None else None,
         ctx.ip if ctx else None],
    )
