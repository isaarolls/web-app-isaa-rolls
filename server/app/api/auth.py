"""Accesso, uscita, profilo, cambio e recupero password."""
import secrets
import smtplib
from email.message import EmailMessage

from pydantic import BaseModel, Field
from starlette.responses import Response

from .. import config, db, security
from ..http import JSON, ApiError, Ctx, api, audit, bad
from ..permissions import PERMISSIONS


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


def _cookie(resp: Response, token: str | None):
    if token:
        resp.set_cookie(security.COOKIE_NAME, token, max_age=config.SESSION_DAYS * 86400, httponly=True,
                        secure=config.COOKIE_SECURE, samesite="lax", path="/")
    else:
        resp.delete_cookie(security.COOKIE_NAME, path="/")


@api("POST", "/auth/login", auth=False)
def login(ctx: Ctx):
    data = ctx.parse(LoginIn)
    email = data.email.strip().lower()
    with db.tx() as c:
        if security.login_blocked(c, ctx.ip, email):
            raise ApiError(429, "Troppi tentativi falliti. Riprova tra 15 minuti.")
        u = c.one("SELECT * FROM users WHERE lower(email)=%s", [email])
        ok = bool(u and u["is_active"] and security.verify_password(data.password, u["password_hash"]))
        c.exec("INSERT INTO login_attempts(email,ip,ok) VALUES (%s,%s,%s)", [email, ctx.ip, ok])
    if not ok:
        raise ApiError(401, "E-mail o password non corretti")
    with db.tx() as c:
        token = security.create_session(c, u["id"], ctx.ip, ctx.request.headers.get("user-agent"))
        c.exec("UPDATE users SET last_login_at=now(), failed_logins=0 WHERE id=%s", [u["id"]])
        c.exec("INSERT INTO audit_log(user_id,action,entity,entity_id,summary,ip) VALUES (%s,'login','user',%s,%s,%s)",
               [u["id"], str(u["id"]), f"Accesso di {u['email']}", ctx.ip])
    resp = JSON({"ok": True, "token": token, "must_change_password": u["must_change_password"]})
    _cookie(resp, token)
    return resp


@api("POST", "/auth/logout")
def logout(ctx: Ctx):
    token, _ = security._token_from_request(ctx.request)
    with db.tx() as c:
        c.exec("UPDATE sessions SET revoked_at=now() WHERE token_hash=%s", [security.token_hash(token)])
    resp = JSON({"ok": True})
    _cookie(resp, None)
    return resp


@api("GET", "/auth/me")
def me(ctx: Ctx):
    with db.read() as c:
        settings = {r["key"]: r["value"] for r in c.all(
            "SELECT key, value FROM settings WHERE key IN ('company','vat_regime','default_sale_vat_rate',"
            "'default_target_margin_pct','expiry_warning_days','due_warning_days','materials_cost_method')")}
    return {"user": ctx.user, "permissions": sorted(ctx.perms), "settings": settings,
            "env": config.APP_ENV}


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


@api("POST", "/auth/change-password")
def change_password(ctx: Ctx):
    data = ctx.parse(ChangePwIn)
    prob = security.password_problems(data.new_password)
    if prob:
        raise bad(prob)
    with db.tx() as c:
        u = c.one("SELECT * FROM users WHERE id=%s FOR UPDATE", [ctx.uid])
        if not security.verify_password(data.current_password, u["password_hash"]):
            raise bad("La password attuale non è corretta")
        c.exec("UPDATE users SET password_hash=%s, must_change_password=false, updated_at=now() WHERE id=%s",
               [security.hash_password(data.new_password), ctx.uid])
        token, _ = security._token_from_request(ctx.request)
        c.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND token_hash<>%s AND revoked_at IS NULL",
               [ctx.uid, security.token_hash(token)])
        audit(c, ctx, "update", "user", ctx.uid, "Cambio password")
    return {"ok": True}


def create_reset_token(c, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    c.exec("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (%s,%s,now() + interval '2 hours')",
           [security.token_hash(token), user_id])
    return token


def send_mail(to: str, subject: str, body: str) -> bool:
    if not config.SMTP_HOST:
        return False
    msg = EmailMessage()
    msg["From"] = config.SMTP_FROM or config.SMTP_USER
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as s:
        s.starttls()
        if config.SMTP_USER:
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(msg)
    return True


class ForgotIn(BaseModel):
    email: str


@api("POST", "/auth/forgot", auth=False)
def forgot(ctx: Ctx):
    data = ctx.parse(ForgotIn)
    sent = False
    with db.tx() as c:
        if security.login_blocked(c, ctx.ip, data.email):
            raise ApiError(429, "Troppi tentativi. Riprova più tardi.")
        c.exec("INSERT INTO login_attempts(email,ip,ok) VALUES (%s,%s,false)", [data.email, ctx.ip])
        u = c.one("SELECT * FROM users WHERE lower(email)=lower(%s) AND is_active", [data.email.strip()])
        if u and config.SMTP_HOST:
            token = create_reset_token(c, u["id"])
            link = f"{config.PUBLIC_URL}/gestionale/#/reimposta-password?token={token}"
            try:
                sent = send_mail(u["email"], "Isaa Rolls Manager – reimpostazione password",
                                 f"Ciao {u['full_name']},\n\nper scegliere una nuova password apri questo link "
                                 f"(valido 2 ore):\n{link}\n\nSe non hai richiesto tu il ripristino, ignora questo messaggio.")
            except Exception:
                sent = False
    # risposta identica in ogni caso, per non rivelare quali e-mail esistono
    return {"ok": True, "email_configured": bool(config.SMTP_HOST),
            "message": "Se l'indirizzo è registrato riceverai un'e-mail con le istruzioni."
            if config.SMTP_HOST else
            "Invio e-mail non configurato: chiedi all'amministratore di generare un link di reimpostazione."}


class ResetIn(BaseModel):
    token: str
    new_password: str


@api("POST", "/auth/reset", auth=False)
def reset(ctx: Ctx):
    data = ctx.parse(ResetIn)
    prob = security.password_problems(data.new_password)
    if prob:
        raise bad(prob)
    with db.tx() as c:
        r = c.one("SELECT * FROM password_resets WHERE token_hash=%s AND used_at IS NULL AND expires_at > now() FOR UPDATE",
                  [security.token_hash(data.token)])
        if not r:
            raise bad("Link non valido o scaduto")
        c.exec("UPDATE password_resets SET used_at=now() WHERE token_hash=%s", [r["token_hash"]])
        c.exec("UPDATE users SET password_hash=%s, must_change_password=false, locked_until=NULL WHERE id=%s",
               [security.hash_password(data.new_password), r["user_id"]])
        c.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", [r["user_id"]])
        audit(c, None, "update", "user", r["user_id"], "Password reimpostata tramite link")
    return {"ok": True}


@api("GET", "/auth/permissions-catalog")
def permissions_catalog(ctx: Ctx):
    return [{"code": k, "module": m, "label": d} for k, (m, d) in PERMISSIONS.items()]
