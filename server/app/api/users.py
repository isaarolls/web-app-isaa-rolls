"""Utenti, ruoli, permessi, registro attività, GDPR."""
import secrets

from pydantic import BaseModel, Field

from .. import config, db, security
from ..http import Ctx, api, audit, bad, conflict, not_found
from ..permissions import PERMISSIONS
from .auth import create_reset_token


def _user_out(c, u):
    over = c.all("SELECT permission, granted FROM user_permissions WHERE user_id=%s", [u["id"]])
    return {k: u[k] for k in ("id", "email", "full_name", "role_id", "is_active", "must_change_password",
                              "last_login_at", "created_at", "anonymized_at")} | {
        "role_name": u.get("role_name"), "overrides": over,
        "active_sessions": c.val("SELECT count(*) FROM sessions WHERE user_id=%s AND revoked_at IS NULL "
                                 "AND expires_at > now()", [u["id"]]),
    }


@api("GET", "/users", "users.manage")
def list_users(ctx: Ctx):
    with db.read() as c:
        rows = c.all("SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.is_active DESC, u.full_name")
        return [_user_out(c, u) for u in rows]


@api("GET", "/roles", ["users.manage", "settings.manage"])
def list_roles(ctx: Ctx):
    with db.read() as c:
        roles = c.all("SELECT * FROM roles ORDER BY id")
        for r in roles:
            r["permissions"] = [x["permission"] for x in c.all(
                "SELECT permission FROM role_permissions WHERE role_id=%s ORDER BY permission", [r["id"]])]
            r["users"] = c.val("SELECT count(*) FROM users WHERE role_id=%s AND is_active", [r["id"]])
        return roles


class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = None
    permissions: list[str]


@api("PUT", "/roles/{id}", "users.manage")
def update_role(ctx: Ctx):
    data = ctx.parse(RoleIn)
    rid = ctx.pid()
    bad_perms = [p for p in data.permissions if p not in PERMISSIONS]
    if bad_perms:
        raise bad("Permessi sconosciuti: " + ", ".join(bad_perms))
    with db.tx() as c:
        role = c.one("SELECT * FROM roles WHERE id=%s", [rid])
        if not role:
            raise not_found("Ruolo")
        if role["code"] == "admin" and "users.manage" not in data.permissions:
            raise bad("Il ruolo amministratore deve mantenere la gestione utenti")
        before = [x["permission"] for x in c.all("SELECT permission FROM role_permissions WHERE role_id=%s", [rid])]
        c.exec("UPDATE roles SET name=%s, description=%s WHERE id=%s", [data.name, data.description, rid])
        c.exec("DELETE FROM role_permissions WHERE role_id=%s", [rid])
        for p in sorted(set(data.permissions)):
            c.exec("INSERT INTO role_permissions(role_id,permission) VALUES (%s,%s)", [rid, p])
        audit(c, ctx, "update", "role", rid, f"Permessi del ruolo «{data.name}» modificati",
              {"permissions": before}, {"permissions": data.permissions})
    return {"ok": True}


@api("POST", "/roles", "users.manage")
def create_role(ctx: Ctx):
    data = ctx.parse(RoleIn)
    with db.tx() as c:
        code = "custom_" + secrets.token_hex(3)
        rid = c.val("INSERT INTO roles(code,name,description) VALUES (%s,%s,%s) RETURNING id",
                    [code, data.name, data.description])
        for p in sorted(set(data.permissions) & set(PERMISSIONS)):
            c.exec("INSERT INTO role_permissions(role_id,permission) VALUES (%s,%s)", [rid, p])
        audit(c, ctx, "create", "role", rid, f"Nuovo ruolo «{data.name}»")
    return {"id": rid}


class UserIn(BaseModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=2, max_length=120)
    role_id: int
    is_active: bool = True
    overrides: list[dict] = []
    password: str | None = None


def _save_overrides(c, uid, overrides):
    c.exec("DELETE FROM user_permissions WHERE user_id=%s", [uid])
    for o in overrides:
        if o.get("permission") in PERMISSIONS:
            c.exec("INSERT INTO user_permissions(user_id,permission,granted) VALUES (%s,%s,%s)",
                   [uid, o["permission"], bool(o.get("granted"))])


@api("POST", "/users", "users.manage")
def create_user(ctx: Ctx):
    data = ctx.parse(UserIn)
    temp = data.password or ("Isa-" + secrets.token_urlsafe(9) + "7a")
    prob = security.password_problems(temp)
    if prob:
        raise bad(prob)
    with db.tx() as c:
        if c.val("SELECT 1 FROM users WHERE lower(email)=lower(%s)", [data.email]):
            raise conflict("Esiste già un utente con questa e-mail")
        uid = c.val(
            "INSERT INTO users(email,full_name,password_hash,role_id,is_active,must_change_password) "
            "VALUES (%s,%s,%s,%s,%s,true) RETURNING id",
            [data.email.strip().lower(), data.full_name.strip(), security.hash_password(temp), data.role_id, data.is_active],
        )
        _save_overrides(c, uid, data.overrides)
        audit(c, ctx, "create", "user", uid, f"Nuovo utente {data.email}", None,
              {"email": data.email, "full_name": data.full_name, "role_id": data.role_id})
    return {"id": uid, "temporary_password": temp}


@api("PUT", "/users/{id}", "users.manage")
def update_user(ctx: Ctx):
    data = ctx.parse(UserIn)
    uid = ctx.pid()
    with db.tx() as c:
        before = c.one("SELECT id,email,full_name,role_id,is_active FROM users WHERE id=%s FOR UPDATE", [uid])
        if not before:
            raise not_found("Utente")
        if uid == ctx.uid and (not data.is_active or data.role_id != before["role_id"]):
            raise bad("Non puoi disattivare o cambiare ruolo al tuo stesso account")
        c.exec("UPDATE users SET email=%s, full_name=%s, role_id=%s, is_active=%s, updated_at=now() WHERE id=%s",
               [data.email.strip().lower(), data.full_name, data.role_id, data.is_active, uid])
        _save_overrides(c, uid, data.overrides)
        admins = c.val("""SELECT count(*) FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id
                          WHERE u.is_active AND rp.permission='users.manage'""")
        if not admins:
            raise bad("Deve restare almeno un amministratore attivo")
        if not data.is_active:
            c.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", [uid])
        audit(c, ctx, "update", "user", uid, f"Utente {data.email} modificato", before,
              {"email": data.email, "full_name": data.full_name, "role_id": data.role_id, "is_active": data.is_active,
               "overrides": data.overrides})
    return {"ok": True}


@api("POST", "/users/{id}/reset-link", "users.manage")
def user_reset_link(ctx: Ctx):
    uid = ctx.pid()
    with db.tx() as c:
        if not c.val("SELECT 1 FROM users WHERE id=%s AND is_active", [uid]):
            raise not_found("Utente")
        token = create_reset_token(c, uid)
        audit(c, ctx, "update", "user", uid, "Generato link di reimpostazione password")
    return {"link": f"{config.PUBLIC_URL}/gestionale/#/reimposta-password?token={token}", "valid_hours": 2}


@api("POST", "/users/{id}/revoke-sessions", "users.manage")
def revoke_sessions(ctx: Ctx):
    uid = ctx.pid()
    with db.tx() as c:
        n = c.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=%s AND revoked_at IS NULL", [uid])
        audit(c, ctx, "update", "user", uid, f"Disconnesse {n} sessioni")
    return {"revoked": n}


@api("GET", "/users/{id}/personal-data", "users.manage")
def personal_data(ctx: Ctx):
    """Esportazione dei dati personali di un utente (GDPR, art. 15/20)."""
    uid = ctx.pid()
    with db.read() as c:
        u = c.one("SELECT id,email,full_name,role_id,is_active,created_at,last_login_at FROM users WHERE id=%s", [uid])
        if not u:
            raise not_found("Utente")
        return {
            "user": u,
            "sessions": c.all("SELECT created_at,last_seen_at,ip,user_agent,revoked_at FROM sessions WHERE user_id=%s", [uid]),
            "activity": c.all("SELECT at,action,entity,entity_id,summary,ip FROM audit_log WHERE user_id=%s ORDER BY at DESC LIMIT 5000", [uid]),
        }


@api("POST", "/users/{id}/anonymize", "users.manage")
def anonymize_user(ctx: Ctx):
    """Cancellazione dei dati personali (GDPR, art. 17): l'utente viene disattivato e reso anonimo;
    le registrazioni aziendali restano, collegate a un identificativo anonimo."""
    uid = ctx.pid()
    if uid == ctx.uid:
        raise bad("Non puoi anonimizzare il tuo account")
    with db.tx() as c:
        u = c.one("SELECT * FROM users WHERE id=%s FOR UPDATE", [uid])
        if not u:
            raise not_found("Utente")
        c.exec(
            "UPDATE users SET email=%s, full_name=%s, is_active=false, password_hash='!', anonymized_at=now() WHERE id=%s",
            [f"anonimo-{uid}@eliminato.invalid", f"Utente eliminato #{uid}", uid],
        )
        c.exec("UPDATE sessions SET revoked_at=now(), ip=NULL, user_agent=NULL WHERE user_id=%s", [uid])
        c.exec("DELETE FROM login_attempts WHERE lower(email)=lower(%s)", [u["email"]])
        audit(c, ctx, "anonymize", "user", uid, f"Dati personali dell'utente #{uid} anonimizzati")
    return {"ok": True}


@api("GET", "/audit", "audit.view")
def audit_list(ctx: Ctx):
    where, params = ["true"], []
    if ctx.q("entity"):
        where.append("a.entity=%s"); params.append(ctx.q("entity"))
    if ctx.q("entity_id"):
        where.append("a.entity_id=%s"); params.append(ctx.q("entity_id"))
    if ctx.q("user_id"):
        where.append("a.user_id=%s"); params.append(ctx.q("user_id", cast=int))
    if ctx.qdate("from"):
        where.append("a.at >= %s::date"); params.append(ctx.qdate("from"))
    if ctx.qdate("to"):
        where.append("a.at < %s::date + 1"); params.append(ctx.qdate("to"))
    if ctx.q("search"):
        where.append("a.summary ILIKE %s"); params.append(f"%{ctx.q('search')}%")
    limit = min(ctx.q("limit", 200, int), 1000)
    with db.read() as c:
        return c.all(
            f"""SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.summary, a.before, a.after, a.ip,
                       u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
                WHERE {' AND '.join(where)} ORDER BY a.at DESC, a.id DESC LIMIT {limit}""",
            params,
        )
