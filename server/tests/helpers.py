"""Supporto ai test: avvia il server su un database di TEST separato e lo azzera."""
import os
import socket
import subprocess
import sys
import time
import unittest

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql://isa:isa_dev_pw@127.0.0.1:5432/isa_test")
ADMIN = ("admin@test.local", "AdminTest2026")

os.environ["DATABASE_URL"] = TEST_DB
os.environ["APP_ENV"] = "test"
sys.path.insert(0, ROOT)

from app import db  # noqa: E402
from app.migrate import migrate  # noqa: E402


def reset_database():
    if "test" not in TEST_DB.rsplit("/", 1)[-1]:
        raise RuntimeError("Per sicurezza i test girano solo su un database il cui nome contiene 'test'")
    db.reset_pool()
    with db.tx() as c:
        c.script("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    migrate(verbose=False)
    from app.cli import create_admin
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        create_admin(ADMIN[0], "Admin Test", ADMIN[1])


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Server:
    proc = None
    url = None

    @classmethod
    def start(cls):
        if cls.proc:
            return
        reset_database()
        port = _free_port()
        env = dict(os.environ, DATABASE_URL=TEST_DB, APP_ENV="test", BACKGROUND_JOBS="0", AUTO_MIGRATE="0",
                   WEB_DIST="/nonexistent")
        cls.proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"],
                                    cwd=ROOT, env=env)
        cls.url = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                if requests.get(cls.url + "/healthz", timeout=1).ok:
                    return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("Il server di test non si è avviato")

    @classmethod
    def stop(cls):
        if cls.proc:
            cls.proc.terminate()
            cls.proc.wait(10)
            cls.proc = None


class Client:
    """Client API con token (come l'app mobile)."""

    def __init__(self, email=ADMIN[0], password=ADMIN[1]):
        self.s = requests.Session()
        r = self.s.post(Server.url + "/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        self.token = r.json()["token"]
        self.s.cookies.clear()
        self.s.headers["Authorization"] = f"Bearer {self.token}"

    def req(self, method, path, expect=200, **kw):
        r = self.s.request(method, Server.url + "/api" + path, **kw)
        if expect is not None and r.status_code != expect:
            raise AssertionError(f"{method} {path} → {r.status_code} (atteso {expect}): {r.text[:500]}")
        ct = r.headers.get("content-type", "")
        return r.json() if ct.startswith("application/json") else r

    def get(self, path, **kw):
        return self.req("GET", path, **kw)

    def post(self, path, json=None, **kw):
        return self.req("POST", path, json=json, **kw)

    def put(self, path, json=None, **kw):
        return self.req("PUT", path, json=json, **kw)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Server.start()
        cls.admin = Client()

    def lookup(self, kind, name):
        for r in self.admin.get(f"/lookups/{kind}"):
            if r["name"] == name:
                return r
        raise KeyError(name)
