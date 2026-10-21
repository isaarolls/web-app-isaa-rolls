"""Sito pubblico Isaa Rolls: dove si trova la bici (in tempo reale) e richieste per eventi/catering."""
import datetime as dt
import json
import logging
import re
import threading
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from .. import config, db
from ..common import setting
from ..http import Ctx, api, audit, bad, not_found

log = logging.getLogger("isa")

STALE_MIN = 20          # oltre questi minuti senza aggiornamenti il sito avvisa che la posizione potrebbe non essere precisa
AUTO_CLOSE_MIN = 360    # oltre questi minuti senza aggiornamenti il sito mostra «chiusi» (telefono dimenticato acceso)
SITE_KEYS = ("instagram", "tiktok", "whatsapp", "phone", "email", "notify_email", "glovo",
             "legal_name", "vat", "address", "review")
PUBLIC_KEYS = ("instagram", "tiktok", "whatsapp", "phone", "email", "glovo", "legal_name", "vat", "address", "review")
# i 14 allergeni del Reg. UE 1169/2011 (codice, italiano, inglese)
ALLERGENS = (("glutine", "Glutine", "Gluten"), ("latte", "Latte", "Milk"), ("uova", "Uova", "Eggs"),
             ("frutta_guscio", "Frutta a guscio", "Tree nuts"), ("arachidi", "Arachidi", "Peanuts"), ("soia", "Soia", "Soy"),
             ("sesamo", "Sesamo", "Sesame"), ("solfiti", "Solfiti", "Sulphites"), ("lupini", "Lupini", "Lupin"),
             ("sedano", "Sedano", "Celery"), ("senape", "Senape", "Mustard"), ("pesce", "Pesce", "Fish"),
             ("crostacei", "Crostacei", "Crustaceans"), ("molluschi", "Molluschi", "Molluscs"))
# prodotti per cui si indicano gli allergeni (codice, italiano, inglese)
ALLERGEN_ITEMS = (("impasto_roll", "Impasto dei rolls", "Rolls dough"), ("impasto_ciambella", "Impasto delle ciambelle", "Donut dough"),
                  ("r_tiramisu", "Roll Tiramisù", "Tiramisù roll"), ("r_cookies", "Roll Cookies", "Cookies roll"),
                  ("r_pistacchioso", "Roll Pistacchioso", "Pistachio roll"), ("r_crema", "Roll Crema gialla", "Custard roll"),
                  ("r_nutellotto", "Roll Nutellotto", "Nutellotto roll"), ("r_galak", "Roll Galak", "Galak roll"),
                  ("c_classica", "Ciambella Classica", "Classic donut"), ("c_nutella", "Ciambella Nutella", "Nutella donut"),
                  ("c_pistacchiosa", "Ciambella Pistacchiosa", "Pistachio donut"), ("c_cookies", "Ciambella Cookies", "Cookies donut"),
                  ("c_tiramisu", "Ciambella Tiramisù", "Tiramisù donut"), ("c_crema", "Ciambella Crema gialla", "Custard donut"),
                  ("extra", "Topping, granelle ed extra", "Toppings, sprinkles and extras"))
_ALL_CODES = {a[0] for a in ALLERGENS}
_ITEM_CODES = {i[0] for i in ALLERGEN_ITEMS}
EVENT_TYPES = ("Matrimonio", "Compleanno / festa privata", "Evento aziendale", "Battesimo / comunione", "Fiera / mercatino", "Altro")
STATUSES = ("nuova", "in_contatto", "preventivo", "confermato", "persa")


def _ip(ctx: Ctx) -> str | None:
    fwd = ctx.request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else ctx.ip


def _site(c) -> dict:
    s = setting(c, "site", {}) or {}
    out = {k: (s.get(k) or "") for k in SITE_KEYS}
    al = s.get("allergens") if isinstance(s.get("allergens"), dict) else {}
    out["allergens"] = {k: [a for a in v if a in _ALL_CODES] for k, v in al.items() if k in _ITEM_CODES and isinstance(v, list)}
    return out


def _allergen_catalog() -> dict:
    return {"allergens": [{"code": c, "it": i, "en": e} for c, i, e in ALLERGENS],
            "items": [{"code": c, "it": i, "en": e} for c, i, e in ALLERGEN_ITEMS]}


def _status_row(c) -> dict:
    return c.one("SELECT b.*, u.full_name AS updated_by_name, "
                 "EXTRACT(EPOCH FROM (now() - b.updated_at))::int AS age_s FROM bike_status b "
                 "LEFT JOIN users u ON u.id=b.updated_by WHERE b.id=1")


# ------------------------------------------------------------------ pubblico

@api("GET", "/public/status", auth=False)
def public_status(ctx: Ctx):
    """Stato della bici per il sito pubblico: aperta con posizione, oppure chiusa (nessuna posizione)."""
    with db.read() as c:
        b = _status_row(c)
        site = _site(c)
        name = (setting(c, "company", {}) or {}).get("name") or "Isaa Rolls"
    info = {k: site[k] for k in PUBLIC_KEYS}
    info["name"] = name
    info["allergens"] = site["allergens"]
    age_min = (b["age_s"] or 0) / 60 if b["updated_at"] else None
    is_open = bool(b["is_open"] and b["lat"] is not None and age_min is not None and age_min < AUTO_CLOSE_MIN)
    out = {"open": is_open, "info": info, "event_types": EVENT_TYPES, "allergen_catalog": _allergen_catalog()}
    if is_open:
        out.update({
            "lat": float(b["lat"]), "lng": float(b["lng"]), "accuracy_m": b["accuracy_m"], "mode": b["mode"],
            "message": b["message"] or "", "updated_at": b["updated_at"], "minutes_ago": int(age_min),
            "stale": age_min > STALE_MIN,
        })
    else:
        out["message"] = (b["message"] or "") if b["is_open"] is False and b["message"] else ""
    return out


class EventIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=6, max_length=40)
    email: str = Field(min_length=5, max_length=160)
    event_type: str = Field(max_length=60)
    event_date: dt.date | None = None
    place: str = Field(min_length=2, max_length=200)
    guests: int | None = Field(default=None, ge=1, le=100000)
    message: str | None = Field(default=None, max_length=3000)
    privacy: bool
    website: str | None = None      # campo trappola per i bot: deve restare vuoto

    @field_validator("email")
    @classmethod
    def _email(cls, v):
        v = v.strip()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Indirizzo e-mail non valido")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        v = v.strip()
        if len(re.sub(r"\D", "", v)) < 6:
            raise ValueError("Numero di telefono non valido")
        return v


def _notify(to: str, req: dict):
    try:
        from .auth import send_mail
        body = "\n".join([
            "Nuova richiesta dal sito Isaa Rolls", "",
            f"Nome: {req['name']}", f"Telefono: {req['phone']}", f"E-mail: {req['email']}",
            f"Evento: {req['event_type']}", f"Data: {req['event_date'].strftime('%d/%m/%Y') if req['event_date'] else '—'}",
            f"Luogo: {req['place']}", f"Ospiti: {req['guests'] or '—'}", "", req["message"] or "", "",
            f"Gestisci la richiesta: {config.PUBLIC_URL.rstrip('/')}/gestionale/#/eventi",
        ])
        send_mail(to, f"Richiesta evento: {req['event_type']} – {req['name']}", body)
    except Exception as e:  # l'e-mail è un di più: la richiesta resta comunque salvata
        log.warning("Notifica richiesta evento non inviata: %s", e)


@api("POST", "/public/event-requests", auth=False)
def create_event_request(ctx: Ctx):
    """Modulo «Eventi e catering» del sito."""
    data = ctx.parse(EventIn)
    if data.website:
        return {"ok": True}          # bot: finge di accettare
    if not data.privacy:
        raise bad("Per inviare la richiesta serve il consenso al trattamento dei dati")
    if data.event_type not in EVENT_TYPES:
        raise bad("Tipo di evento non valido")
    if data.event_date and data.event_date < dt.date.today():
        raise bad("La data dell'evento è già passata")
    ip = _ip(ctx)
    with db.tx() as c:
        n = c.val("SELECT count(*) FROM public_posts WHERE ip IS NOT DISTINCT FROM %s AND at > now() - interval '1 hour'", [ip])
        if n >= 5:
            raise bad("Hai già inviato diverse richieste: riprova più tardi o contattaci direttamente")
        c.exec("INSERT INTO public_posts(ip) VALUES (%s)", [ip])
        c.exec("DELETE FROM public_posts WHERE at < now() - interval '1 day'")
        row = c.one(
            """INSERT INTO event_requests(name,phone,email,event_type,event_date,place,guests,message,ip)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            [data.name.strip(), data.phone, data.email, data.event_type, data.event_date, data.place.strip(), data.guests,
             (data.message or "").strip() or None, ip])
        site = _site(c)
    to = site["notify_email"] or site["email"]
    if to:
        threading.Thread(target=_notify, args=(to, row), daemon=True).start()
    return {"ok": True}


# ------------------------------------------------------------------ gestionale: posizione bici

@api("GET", "/bike", "location.share")
def bike_status(ctx: Ctx):
    with db.read() as c:
        b = _status_row(c)
        site = _site(c)
    b["site"] = site if ctx.can("settings.manage") else None
    b["allergen_catalog"] = _allergen_catalog() if ctx.can("settings.manage") else None
    b["auto_close_min"] = AUTO_CLOSE_MIN
    return b


class BikeIn(BaseModel):
    action: str                          # live | fissa | aggiorna | chiudi | messaggio
    lat: Decimal | None = Field(default=None, ge=-90, le=90)
    lng: Decimal | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    message: str | None = Field(default=None, max_length=200)


@api("POST", "/bike", "location.share")
def bike_update(ctx: Ctx):
    data = ctx.parse(BikeIn)
    acc = int(min(data.accuracy_m, 100000)) if data.accuracy_m is not None else None
    with db.tx() as c:
        b = c.one("SELECT * FROM bike_status WHERE id=1 FOR UPDATE")
        if data.action in ("live", "fissa", "aggiorna"):
            if data.lat is None or data.lng is None:
                raise bad("Posizione non disponibile: attiva la localizzazione sul telefono")
            if data.action == "aggiorna" and not (b["is_open"] and b["mode"] == "live"):
                return {"ignored": True, "is_open": b["is_open"]}   # il telefono continua a inviare ma la bici è stata chiusa
            mode = "live" if data.action in ("live", "aggiorna") else "fissa"
            c.exec("""UPDATE bike_status SET is_open=true, mode=%s, lat=%s, lng=%s, accuracy_m=%s, updated_at=now(),
                      opened_at=CASE WHEN is_open THEN opened_at ELSE now() END, updated_by=%s,
                      message=COALESCE(%s, message) WHERE id=1""",
                   [mode, round(data.lat, 6), round(data.lng, 6), acc, ctx.uid, data.message])
            if data.action != "aggiorna":
                audit(c, ctx, "update", "bike", 1, "Bici aperta: posizione " + ("in tempo reale" if mode == "live" else "fissa"))
        elif data.action == "chiudi":
            c.exec("UPDATE bike_status SET is_open=false, updated_at=now(), updated_by=%s, message=%s WHERE id=1",
                   [ctx.uid, data.message])
            audit(c, ctx, "update", "bike", 1, "Bici chiusa: posizione nascosta dal sito")
        elif data.action == "messaggio":
            c.exec("UPDATE bike_status SET message=%s, updated_by=%s WHERE id=1", [data.message or None, ctx.uid])
        else:
            raise bad("Azione non valida")
        return _status_row(c)


class SiteIn(BaseModel):
    instagram: str | None = Field(default=None, max_length=200)
    tiktok: str | None = Field(default=None, max_length=200)
    whatsapp: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=160)
    notify_email: str | None = Field(default=None, max_length=160)
    glovo: str | None = Field(default=None, max_length=400)
    legal_name: str | None = Field(default=None, max_length=160)
    vat: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=200)
    review: str | None = Field(default=None, max_length=400)
    allergens: dict[str, list[str]] | None = None


@api("PUT", "/site-info", "settings.manage")
def put_site_info(ctx: Ctx):
    parsed = ctx.parse(SiteIn)
    with db.read() as c:
        current = _site(c)
    # si aggiornano solo i campi inviati: il modulo dei dati e quello degli allergeni si salvano separatamente
    data = {k: (getattr(parsed, k).strip() if getattr(parsed, k) is not None else current[k]) for k in SITE_KEYS}
    data["allergens"] = current["allergens"] if parsed.allergens is None else {}
    for item, codes in (parsed.allergens or {}).items():
        if item not in _ITEM_CODES:
            raise bad("Prodotto non valido nella tabella allergeni")
        bad_codes = [a for a in codes if a not in _ALL_CODES]
        if bad_codes:
            raise bad("Allergene non valido: " + ", ".join(bad_codes))
        if codes:
            data["allergens"][item] = [a[0] for a in ALLERGENS if a[0] in codes]   # ordine fisso, senza doppioni
    vat = re.sub(r"[\s.]", "", data["vat"]).upper().removeprefix("IT")
    if vat and not re.fullmatch(r"\d{11}", vat):
        raise bad("La partita IVA deve avere 11 cifre")
    data["vat"] = vat
    if data["review"] and not data["review"].startswith("https://"):
        raise bad("Il link per le recensioni deve iniziare con https:// (copialo da Google: Chiedi recensioni → Copia link)")
    if data["glovo"] and not data["glovo"].startswith("https://"):
        raise bad("Il link di Glovo deve iniziare con https:// (copialo dall'app Glovo: Condividi negozio)")
    for k in ("instagram", "tiktok"):
        v = data[k]
        if v and not v.startswith("http"):
            handle = v.lstrip("@")
            data[k] = f"https://www.instagram.com/{handle}" if k == "instagram" else f"https://www.tiktok.com/@{handle}"
    with db.tx() as c:
        before = setting(c, "site", {})
        c.exec("INSERT INTO settings(key,value) VALUES ('site',%s::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
               [json.dumps(data)])
        audit(c, ctx, "update", "settings", "site", "Dati del sito modificati", before, data)
    return data


# ------------------------------------------------------------------ gestionale: richieste eventi

@api("GET", "/event-requests", "events.view")
def list_event_requests(ctx: Ctx):
    with db.read() as c:
        return c.all("SELECT r.*, u.full_name AS updated_by_name FROM event_requests r LEFT JOIN users u ON u.id=r.updated_by "
                     "ORDER BY (r.status='nuova') DESC, r.created_at DESC LIMIT 500")


class EventUpd(BaseModel):
    status: str
    notes: str | None = Field(default=None, max_length=3000)


@api("PUT", "/event-requests/{id}", "events.view")
def update_event_request(ctx: Ctx):
    data = ctx.parse(EventUpd)
    if data.status not in STATUSES:
        raise bad("Stato non valido")
    with db.tx() as c:
        before = c.one("SELECT * FROM event_requests WHERE id=%s FOR UPDATE", [ctx.pid()])
        if not before:
            raise not_found("Richiesta")
        row = c.one("UPDATE event_requests SET status=%s, notes=%s, updated_at=now(), updated_by=%s WHERE id=%s RETURNING *",
                    [data.status, data.notes, ctx.uid, before["id"]])
        audit(c, ctx, "update", "event_request", before["id"], f"Richiesta evento di {before['name']}: {data.status}")
    return row
