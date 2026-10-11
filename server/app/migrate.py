"""Sistema di migrazioni del database.

Uso:  python -m app.migrate            (applica le migrazioni mancanti)
      python -m app.migrate --status   (mostra lo stato)

Le migrazioni stanno in app/migrations/ (NNN_nome.sql oppure NNN_nome.py con funzione run(c)).
Ogni migrazione è applicata in una transazione; un lock impedisce esecuzioni concorrenti.
"""
import importlib.util
import os
import sys

from . import db

MIG_DIR = os.path.join(os.path.dirname(__file__), "migrations")
LOCK_ID = 7461001


def _files():
    return sorted(f for f in os.listdir(MIG_DIR) if f[:3].isdigit() and f.endswith((".sql", ".py")))


def migrate(verbose=True) -> list[str]:
    applied_now = []
    with db.tx() as c:
        c.exec("SELECT pg_advisory_xact_lock(%s)", [LOCK_ID])
        c.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {r["name"] for r in c.all("SELECT name FROM schema_migrations")}
        for f in _files():
            if f in done:
                continue
            path = os.path.join(MIG_DIR, f)
            if f.endswith(".sql"):
                with open(path, encoding="utf-8") as fh:
                    c.script(fh.read())
            else:
                spec = importlib.util.spec_from_file_location(f"mig_{f[:-3]}", path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                mod.run(c)
            c.exec("INSERT INTO schema_migrations(name) VALUES (%s)", [f])
            applied_now.append(f)
            if verbose:
                print(f"  applicata: {f}")
    if verbose:
        print("Database aggiornato." if applied_now else "Nessuna migrazione da applicare.")
    return applied_now


def status():
    with db.tx() as c:
        c.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        done = {r["name"]: r["applied_at"] for r in c.all("SELECT * FROM schema_migrations")}
    for f in _files():
        print(f"{'OK ' if f in done else '-- '} {f}")


if __name__ == "__main__":
    status() if "--status" in sys.argv else migrate()
