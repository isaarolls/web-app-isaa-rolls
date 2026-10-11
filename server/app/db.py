"""Accesso al database PostgreSQL.

- Pool di connessioni thread-safe.
- Transazioni esplicite: `with db.tx() as c:` esegue COMMIT alla fine o ROLLBACK in caso di errore.
- Segnaposto stile psycopg: %s
- Usa psycopg 3 se installato, altrimenti il driver libpq di ripiego (app/pq.py).
"""
from __future__ import annotations

import json
import queue
import threading
from contextlib import contextmanager
from typing import Any, Iterator

from . import config

try:  # pragma: no cover - dipende dall'ambiente
    import psycopg  # type: ignore

    HAVE_PSYCOPG = True
except Exception:  # pragma: no cover
    HAVE_PSYCOPG = False

from .pq import DatabaseError  # usata da entrambi i driver


class _PsycopgConn:  # pragma: no cover - percorso usato in produzione
    def __init__(self, dsn: str):
        try:
            self._c = psycopg.connect(dsn, autocommit=True)
        except Exception as e:
            raise DatabaseError(f"Connessione al database non riuscita: {e}")

    def execute(self, sql, params=None):
        try:
            cur = self._c.execute(sql, params or None, prepare=False)
            cols = [d.name for d in cur.description] if cur.description else []
            rows = [tuple(r) for r in cur.fetchall()] if cur.description else []
            return cols, rows, cur.rowcount
        except psycopg.Error as e:
            diag = getattr(e, "diag", None)
            raise DatabaseError(
                str(e).strip(),
                getattr(e, "sqlstate", None),
                getattr(diag, "constraint_name", None) if diag else None,
            )

    def execute_script(self, sql):
        try:
            self._c.execute(sql)
        except psycopg.Error as e:
            raise DatabaseError(str(e).strip(), getattr(e, "sqlstate", None))

    @property
    def broken(self):
        return self._c.closed or self._c.broken

    def close(self):
        self._c.close()


def _connect():
    if HAVE_PSYCOPG:
        conn = _PsycopgConn(config.DATABASE_URL)
    else:
        from .pq import Connection

        conn = Connection(config.DATABASE_URL)
    conn.execute("SET TIME ZONE 'Europe/Rome'")
    conn.execute("SET datestyle = 'ISO, DMY'")
    conn.execute("SET client_min_messages = warning")
    return conn


def _prep(params):
    if params is None:
        return None
    out = []
    for p in params:
        if isinstance(p, dict) or (isinstance(p, list) and p and isinstance(p[0], dict)):
            out.append(json.dumps(p, default=str))
        else:
            out.append(p)
    return out


class Cursor:
    """Interfaccia comoda sopra una connessione."""

    def __init__(self, conn):
        self.conn = conn

    def exec(self, sql: str, params=None) -> int:
        _, _, n = self.conn.execute(sql, _prep(params))
        return n

    def all(self, sql: str, params=None) -> list[dict[str, Any]]:
        cols, rows, _ = self.conn.execute(sql, _prep(params))
        return [dict(zip(cols, r)) for r in rows]

    def one(self, sql: str, params=None) -> dict[str, Any] | None:
        r = self.all(sql, params)
        return r[0] if r else None

    def val(self, sql: str, params=None):
        cols, rows, _ = self.conn.execute(sql, _prep(params))
        return rows[0][0] if rows else None

    def script(self, sql: str):
        self.conn.execute_script(sql)


class Pool:
    def __init__(self, size: int):
        self.size = size
        self._q: queue.Queue = queue.Queue()
        self._created = 0
        self._lock = threading.Lock()

    def get(self):
        try:
            c = self._q.get_nowait()
        except queue.Empty:
            with self._lock:
                if self._created < self.size:
                    self._created += 1
                    try:
                        return _connect()
                    except Exception:
                        self._created -= 1
                        raise
            c = self._q.get(timeout=30)
        if c.broken:
            c.close()
            with self._lock:
                self._created -= 1
            return self.get()
        return c

    def put(self, c):
        if c.broken:
            c.close()
            with self._lock:
                self._created -= 1
        else:
            self._q.put(c)

    def close_all(self):
        while True:
            try:
                self._q.get_nowait().close()
            except queue.Empty:
                break
        self._created = 0


_pool: Pool | None = None


def pool() -> Pool:
    global _pool
    if _pool is None:
        _pool = Pool(config.DB_POOL_SIZE)
    return _pool


def reset_pool():
    global _pool
    if _pool:
        _pool.close_all()
    _pool = None


@contextmanager
def tx(isolation: str | None = None) -> Iterator[Cursor]:
    """Transazione: COMMIT se il blocco termina, ROLLBACK in caso di eccezione."""
    p = pool()
    conn = p.get()
    try:
        conn.execute("BEGIN" + (f" ISOLATION LEVEL {isolation}" if isolation else ""))
        cur = Cursor(conn)
        try:
            yield cur
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        conn.execute("COMMIT")
    finally:
        p.put(conn)


@contextmanager
def read() -> Iterator[Cursor]:
    """Sola lettura (snapshot coerente)."""
    with tx("REPEATABLE READ") as c:
        c.exec("SET TRANSACTION READ ONLY")
        yield c
