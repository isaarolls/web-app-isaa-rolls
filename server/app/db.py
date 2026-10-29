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
import time
from contextlib import contextmanager
from typing import Any, Iterator

from . import config

try:  # pragma: no cover - dipende dall'ambiente
    import psycopg  # type: ignore

    HAVE_PSYCOPG = True
except Exception:  # pragma: no cover
    HAVE_PSYCOPG = False

from .pq import DatabaseError  # usata da entrambi i driver


def _ipv4_target(dsn: str) -> dict | None:
    """Parametri per collegarsi al database solo via IPv4.

    Render non ha rete IPv6 in uscita: se il nome del database (es. Neon) risolve anche in IPv6,
    i tentativi su IPv6 falliscono con «Network is unreachable». Con gli indirizzi IPv4 il collegamento è affidabile.
    Il nome resta in «host» per la verifica TLS e per l'instradamento di Neon (SNI).
    """
    import socket
    from urllib.parse import urlsplit
    if not dsn.startswith(("postgres://", "postgresql://")):
        return None
    try:
        host = urlsplit(dsn).hostname
    except ValueError:
        return None
    if not host or "," in (urlsplit(dsn).netloc or ""):
        return None
    try:
        socket.inet_pton(socket.AF_INET, host)
        return None            # è già un indirizzo IPv4
    except OSError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return None
    ips = list(dict.fromkeys(i[4][0] for i in infos))[:4]
    if not ips:
        return None
    # libpq vuole lo stesso numero di voci in host e hostaddr
    return {"host": ",".join([host] * len(ips)), "hostaddr": ",".join(ips)}


class _PsycopgConn:  # pragma: no cover - percorso usato in produzione
    def __init__(self, dsn: str):
        try:
            target = _ipv4_target(dsn)
            ipv4_err = None
            if target:
                try:
                    self._c = psycopg.connect(dsn, autocommit=True, connect_timeout=10, **target)
                    return
                except psycopg.OperationalError as e:
                    ipv4_err = e       # si riprova nel modo normale, ma l'errore IPv4 resta nel messaggio
            try:
                self._c = psycopg.connect(dsn, autocommit=True, connect_timeout=10)
            except Exception as e:
                v4 = (f"IPv4 {target['hostaddr']}: {ipv4_err}" if ipv4_err else
                      ("IPv4: tentato senza errore" if target else "IPv4: nessun indirizzo IPv4 trovato per il database"))
                raise DatabaseError(f"Connessione al database non riuscita. [{v4}] [normale: {e}]")
        except DatabaseError:
            raise
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
        self._closed = False
        threading.Thread(target=self._reaper, daemon=True).start()

    def _reaper(self):
        while not self._closed:
            time.sleep(20)
            try:
                self._close_idle()
            except Exception:
                pass

    IDLE_CLOSE_S = 60      # connessioni inutilizzate da più di un minuto vengono chiuse

    def _close_idle(self):
        """Chiude le connessioni ferme: così Neon può mettere in pausa il database quando nessuno lo usa
        (il piano gratuito ha un limite di ore di calcolo al mese)."""
        now = time.monotonic()
        keep = []
        while True:
            try:
                c, since = self._q.get_nowait()
            except queue.Empty:
                break
            if now - since > self.IDLE_CLOSE_S:
                try:
                    c.close()
                except Exception:
                    pass
                with self._lock:
                    self._created -= 1
            else:
                keep.append((c, since))
        for item in keep:
            self._q.put(item)

    def get(self):
        self._close_idle()
        try:
            c, _ = self._q.get_nowait()
        except queue.Empty:
            with self._lock:
                if self._created < self.size:
                    self._created += 1
                    try:
                        return _connect()
                    except Exception:
                        self._created -= 1
                        raise
            c, _ = self._q.get(timeout=30)
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
            self._q.put((c, time.monotonic()))

    def close_all(self):
        self._closed = True
        while True:
            try:
                self._q.get_nowait()[0].close()
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
    begin = "BEGIN" + (f" ISOLATION LEVEL {isolation}" if isolation else "")
    try:
        conn.execute(begin)
    except DatabaseError:
        # connessione chiusa dal server (es. database che si sospende quando inattivo): ne apre una nuova
        conn.close()
        with p._lock:
            p._created -= 1
        conn = p.get()
        conn.execute(begin)
    try:
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
