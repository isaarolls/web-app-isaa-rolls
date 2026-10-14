"""Nuovi permessi del sito: a titolare e responsabile tutti, al dipendente la condivisione della posizione."""
from app.permissions import ROLES


def run(c):
    for code in ("admin", "responsabile", "vendite"):
        rid = c.val("SELECT id FROM roles WHERE code=%s", [code])
        if not rid:
            continue
        for p in ("location.share", "events.view"):
            if p in ROLES[code]["permissions"]:
                c.exec("INSERT INTO role_permissions(role_id,permission) SELECT %s,%s WHERE NOT EXISTS "
                       "(SELECT 1 FROM role_permissions WHERE role_id=%s AND permission=%s)", [rid, p, rid, p])
