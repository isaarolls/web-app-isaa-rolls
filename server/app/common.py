"""Funzioni comuni: importi, IVA, date, impostazioni."""
from __future__ import annotations

import datetime as dt
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from . import db

TZ = ZoneInfo("Europe/Rome")
ZERO = Decimal("0")
CENT = Decimal("0.01")


def D(x) -> Decimal:
    """Converte in Decimal accettando anche il formato italiano '1.234,56'."""
    if x is None or x == "":
        return ZERO
    if isinstance(x, Decimal):
        return x
    if isinstance(x, (int,)):
        return Decimal(x)
    if isinstance(x, float):
        return Decimal(repr(x))
    s = str(x).strip().replace("€", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        raise ValueError(f"Numero non valido: {x}")


def q2(x) -> Decimal:
    return D(x).quantize(CENT, rounding=ROUND_HALF_UP)


def q4(x) -> Decimal:
    return D(x).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def q6(x) -> Decimal:
    return D(x).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def split_vat(gross, rate) -> tuple[Decimal, Decimal]:
    """Scorpora l'IVA da un importo IVA inclusa. Restituisce (imponibile, iva); la somma è sempre esatta."""
    gross = q2(gross)
    rate = D(rate)
    net = q2(gross / (1 + rate / 100))
    return net, gross - net


def add_vat(net, rate) -> tuple[Decimal, Decimal]:
    net = q2(net)
    vat = q2(net * D(rate) / 100)
    return vat, net + vat


def now() -> dt.datetime:
    return dt.datetime.now(TZ)


def today() -> dt.date:
    return now().date()


def to_local(ts: dt.datetime) -> dt.datetime:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=TZ)
    return ts.astimezone(TZ)


def month_start(d: dt.date) -> dt.date:
    return d.replace(day=1)


def month_end(d: dt.date) -> dt.date:
    nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return nxt - dt.timedelta(days=1)


def add_months(d: dt.date, n: int) -> dt.date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    last = month_end(dt.date(y, m, 1)).day
    return dt.date(y, m, min(d.day, last))


def get_settings(c: db.Cursor) -> dict:
    return {r["key"]: r["value"] for r in c.all("SELECT key, value FROM settings")}


def setting(c: db.Cursor, key: str, default=None):
    v = c.val("SELECT value FROM settings WHERE key=%s", [key])
    return default if v is None else v


def parse_ts(v) -> dt.datetime | None:
    if v in (None, ""):
        return None
    if isinstance(v, dt.datetime):
        return to_local(v)
    s = str(v)
    if len(s) == 10:
        return dt.datetime.fromisoformat(s).replace(hour=12, tzinfo=TZ)
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return to_local(t)
