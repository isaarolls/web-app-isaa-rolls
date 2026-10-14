"""Numero di telefono e WhatsApp di Isaa Rolls sul sito (se non già impostati)."""
import json

NUMBER = "+39 327 440 4800"


def run(c):
    v = c.val("SELECT value FROM settings WHERE key='site'") or {}
    changed = False
    for k in ("whatsapp", "phone"):
        if not v.get(k):
            v[k] = NUMBER
            changed = True
    if changed:
        c.exec("INSERT INTO settings(key,value) VALUES ('site',%s::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
               [json.dumps(v)])
