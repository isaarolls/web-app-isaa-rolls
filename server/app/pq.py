"""Driver PostgreSQL minimale basato su libpq (ctypes).

Usato SOLO come ripiego quando il pacchetto `psycopg` non è installato
(ad es. ambienti di sviluppo senza accesso a PyPI). In produzione si usa
psycopg 3 (vedi requirements.txt): l'interfaccia esposta a `app.db` è la stessa.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import datetime as dt
import json
from decimal import Decimal

_lib_name = ctypes.util.find_library("pq") or "libpq.so.5"
_lib = ctypes.CDLL(_lib_name)

_lib.PQconnectdb.restype = ctypes.c_void_p
_lib.PQconnectdb.argtypes = [ctypes.c_char_p]
_lib.PQstatus.argtypes = [ctypes.c_void_p]
_lib.PQerrorMessage.restype = ctypes.c_char_p
_lib.PQerrorMessage.argtypes = [ctypes.c_void_p]
_lib.PQfinish.argtypes = [ctypes.c_void_p]
_lib.PQexecParams.restype = ctypes.c_void_p
_lib.PQexecParams.argtypes = [
    ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p,
    ctypes.POINTER(ctypes.c_char_p), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int,
]
_lib.PQexec.restype = ctypes.c_void_p
_lib.PQexec.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
_lib.PQresultStatus.argtypes = [ctypes.c_void_p]
_lib.PQresultErrorMessage.restype = ctypes.c_char_p
_lib.PQresultErrorMessage.argtypes = [ctypes.c_void_p]
_lib.PQresultErrorField.restype = ctypes.c_char_p
_lib.PQresultErrorField.argtypes = [ctypes.c_void_p, ctypes.c_int]
_lib.PQntuples.argtypes = [ctypes.c_void_p]
_lib.PQnfields.argtypes = [ctypes.c_void_p]
_lib.PQfname.restype = ctypes.c_char_p
_lib.PQfname.argtypes = [ctypes.c_void_p, ctypes.c_int]
_lib.PQftype.restype = ctypes.c_uint
_lib.PQftype.argtypes = [ctypes.c_void_p, ctypes.c_int]
_lib.PQgetvalue.restype = ctypes.c_void_p
_lib.PQgetvalue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
_lib.PQgetlength.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
_lib.PQgetisnull.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
_lib.PQclear.argtypes = [ctypes.c_void_p]
_lib.PQcmdTuples.restype = ctypes.c_char_p
_lib.PQcmdTuples.argtypes = [ctypes.c_void_p]
_lib.PQtransactionStatus.argtypes = [ctypes.c_void_p]

CONNECTION_OK = 0
PGRES_COMMAND_OK = 1
PGRES_TUPLES_OK = 2
PG_DIAG_SQLSTATE = ord("C")
PG_DIAG_CONSTRAINT_NAME = ord("n")


class DatabaseError(Exception):
    def __init__(self, message: str, sqlstate: str | None = None, constraint: str | None = None):
        super().__init__(message)
        self.sqlstate = sqlstate
        self.constraint = constraint


def _parse_ts(s: str) -> dt.datetime:
    # formato: 2026-10-11 16:12:40.497814+02 (oppure +05:30)
    if s.endswith(("+00", "-00")) or (len(s) > 3 and s[-3] in "+-" and s[-2:].isdigit()):
        s = s + ":00"
    return dt.datetime.fromisoformat(s)


def _convert(oid: int, raw: str):
    if oid in (20, 21, 23, 26):
        return int(raw)
    if oid == 1700:
        return Decimal(raw)
    if oid in (700, 701):
        return float(raw)
    if oid == 16:
        return raw == "t"
    if oid == 1082:
        return dt.date.fromisoformat(raw)
    if oid == 1184:
        return _parse_ts(raw)
    if oid == 1114:
        return dt.datetime.fromisoformat(raw)
    if oid in (114, 3802):
        return json.loads(raw)
    if oid == 17:  # bytea in formato hex
        return bytes.fromhex(raw[2:]) if raw.startswith("\\x") else raw.encode()
    if oid in (1007, 1016):  # int[]
        inner = raw.strip("{}")
        return [int(x) for x in inner.split(",")] if inner else []
    if oid in (1009, 1015):  # text[]
        inner = raw.strip("{}")
        return [x.strip('"') for x in inner.split(",")] if inner else []
    return raw


def _to_text(v) -> bytes | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return b"t" if v else b"f"
    if isinstance(v, (bytes, bytearray, memoryview)):
        return ("\\x" + bytes(v).hex()).encode()
    if isinstance(v, (list, tuple)):
        parts = []
        for x in v:
            if x is None:
                parts.append("NULL")
            else:
                s = str(x).replace("\\", "\\\\").replace('"', '\\"')
                parts.append(f'"{s}"')
        return ("{" + ",".join(parts) + "}").encode()
    if isinstance(v, (dict,)):
        return json.dumps(v, default=str).encode()
    if isinstance(v, dt.datetime):
        return v.isoformat().encode()
    return str(v).encode()


def _convert_placeholders(sql: str) -> str:
    """Converte i segnaposto %s (stile psycopg) in $1, $2, ... ; '%%' -> '%'."""
    out = []
    n = 0
    i = 0
    while i < len(sql):
        c = sql[i]
        if c == "%" and i + 1 < len(sql):
            nxt = sql[i + 1]
            if nxt == "s":
                n += 1
                out.append(f"${n}")
                i += 2
                continue
            if nxt == "%":
                out.append("%")
                i += 2
                continue
        out.append(c)
        i += 1
    return "".join(out)


class Connection:
    def __init__(self, dsn: str):
        self._conn = _lib.PQconnectdb(dsn.encode())
        if _lib.PQstatus(self._conn) != CONNECTION_OK:
            msg = _lib.PQerrorMessage(self._conn).decode(errors="replace")
            _lib.PQfinish(self._conn)
            self._conn = None
            raise DatabaseError(f"Connessione al database non riuscita: {msg}")
        self.closed = False

    def execute(self, sql: str, params=None):
        """Esegue la query e restituisce (colonne, righe, rowcount)."""
        params = list(params or [])
        q = _convert_placeholders(sql) if params or "%" in sql else sql
        if params:
            arr = (ctypes.c_char_p * len(params))(*[_to_text(p) for p in params])
            res = _lib.PQexecParams(self._conn, q.encode(), len(params), None, arr, None, None, 0)
        else:
            res = _lib.PQexecParams(self._conn, q.encode(), 0, None, None, None, None, 0)
        try:
            st = _lib.PQresultStatus(res)
            if st not in (PGRES_COMMAND_OK, PGRES_TUPLES_OK):
                msg = (_lib.PQresultErrorMessage(res) or b"").decode(errors="replace").strip()
                state = _lib.PQresultErrorField(res, PG_DIAG_SQLSTATE)
                cons = _lib.PQresultErrorField(res, PG_DIAG_CONSTRAINT_NAME)
                raise DatabaseError(msg, state.decode() if state else None, cons.decode() if cons else None)
            nf = _lib.PQnfields(res)
            cols = [_lib.PQfname(res, j).decode() for j in range(nf)]
            types = [_lib.PQftype(res, j) for j in range(nf)]
            rows = []
            for i in range(_lib.PQntuples(res)):
                row = []
                for j in range(nf):
                    if _lib.PQgetisnull(res, i, j):
                        row.append(None)
                    else:
                        ln = _lib.PQgetlength(res, i, j)
                        raw = ctypes.string_at(_lib.PQgetvalue(res, i, j), ln).decode()
                        row.append(_convert(types[j], raw))
                rows.append(tuple(row))
            ct = (_lib.PQcmdTuples(res) or b"").decode()
            return cols, rows, int(ct) if ct.isdigit() else -1
        finally:
            _lib.PQclear(res)

    def execute_script(self, sql: str):
        res = _lib.PQexec(self._conn, sql.encode())
        try:
            st = _lib.PQresultStatus(res)
            if st not in (PGRES_COMMAND_OK, PGRES_TUPLES_OK):
                msg = (_lib.PQresultErrorMessage(res) or b"").decode(errors="replace").strip()
                raise DatabaseError(msg)
        finally:
            _lib.PQclear(res)

    @property
    def broken(self) -> bool:
        return self._conn is None or _lib.PQstatus(self._conn) != CONNECTION_OK

    def close(self):
        if self._conn:
            _lib.PQfinish(self._conn)
            self._conn = None
        self.closed = True
