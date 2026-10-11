"""Password, sessioni e permessi."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets

from . import config, db

COOKIE_NAME = "isa_session"

# scrypt (libreria standard): parametri robusti per password
_N, _R, _P = 2**15, 8, 1


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=64 * 1024 * 1024, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, h = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                              maxmem=64 * 1024 * 1024, dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except Exception:
        return False


def password_problems(pw: str) -> str | None:
    if len(pw) < 10:
        return "La password deve avere almeno 10 caratteri"
    if pw.lower() == pw or pw.upper() == pw or not any(ch.isdigit() for ch in pw):
        return "La password deve contenere lettere maiuscole, minuscole e almeno un numero"
    return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(c: db.Cursor, user_id: int, ip: str | None, ua: str | None) -> str:
    token = secrets.token_urlsafe(32)
    c.exec(
        "INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent) VALUES (%s,%s,now() + %s::interval,%s,%s)",
        [token_hash(token), user_id, f"{config.SESSION_DAYS} days", ip, (ua or "")[:300]],
    )
    return token


def permissions_for(c: db.Cursor, user_id: int) -> set[str]:
    rows = c.all(
        """SELECT rp.permission FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
           WHERE u.id = %s""",
        [user_id],
    )
    perms = {r["permission"] for r in rows}
    for o in c.all("SELECT permission, granted FROM user_permissions WHERE user_id=%s", [user_id]):
        if o["granted"]:
            perms.add(o["permission"])
        else:
            perms.discard(o["permission"])
    return perms


def _token_from_request(request) -> tuple[str | None, bool]:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    tok = request.cookies.get(COOKIE_NAME)
    return (tok, True) if tok else (None, False)


def authenticate(request):
    token, via_cookie = _token_from_request(request)
    if not token:
        return None, set(), False
    with db.tx() as c:
        row = c.one(
            """SELECT s.id AS sid, s.last_seen_at, u.id, u.email, u.full_name, u.role_id, u.must_change_password,
                      r.code AS role_code, r.name AS role_name
               FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
               WHERE s.token_hash = %s AND s.revoked_at IS NULL AND s.expires_at > now()
                 AND s.last_seen_at > now() - %s::interval AND u.is_active""",
            [token_hash(token), f"{config.SESSION_IDLE_HOURS} hours"],
        )
        if not row:
            return None, set(), via_cookie
        if row["last_seen_at"] < dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=5):
            c.exec("UPDATE sessions SET last_seen_at = now() WHERE id = %s", [row["sid"]])
        perms = permissions_for(c, row["id"])
    row.pop("last_seen_at", None)
    return row, perms, via_cookie


def login_blocked(c: db.Cursor, ip: str | None, email: str) -> bool:
    """Limita i tentativi: max 10 falliti per IP o per e-mail in 15 minuti."""
    n = c.val(
        "SELECT count(*) FROM login_attempts WHERE NOT ok AND at > now() - interval '15 minutes' "
        "AND (ip = %s OR lower(email) = lower(%s))",
        [ip, email],
    )
    return n >= 10
