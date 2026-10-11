"""Aggiorna i ruoli di sistema: Responsabile con accesso completo, Dipendente solo vendite."""
from app.permissions import ROLES


def run(c):
    for code in ("responsabile", "vendite"):
        r = ROLES[code]
        rid = c.val("SELECT id FROM roles WHERE code=%s", [code])
        if not rid:
            continue
        c.exec("UPDATE roles SET name=%s, description=%s WHERE id=%s", [r["name"], r["description"], rid])
        c.exec("DELETE FROM role_permissions WHERE role_id=%s", [rid])
        for p in r["permissions"]:
            c.exec("INSERT INTO role_permissions(role_id,permission) VALUES (%s,%s)", [rid, p])
