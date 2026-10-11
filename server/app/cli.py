"""Comandi di amministrazione.

  python -m app.cli create-admin --email titolare@esempio.it --name "Nome Cognome"
        crea il primo amministratore (password temporanea mostrata a video, da cambiare al primo accesso)
  python -m app.cli reset-password --email utente@esempio.it
        genera una nuova password temporanea
  python -m app.cli check
        verifica la coerenza di giacenze e movimenti
"""
import argparse
import secrets
import sys

from . import db, security
from .migrate import migrate


def _temp_password():
    return "Isa-" + secrets.token_urlsafe(9) + "7a"


def create_admin(email: str, name: str, password: str | None):
    migrate(verbose=False)
    pw = password or _temp_password()
    prob = security.password_problems(pw)
    if prob:
        sys.exit(prob)
    with db.tx() as c:
        if c.val("SELECT 1 FROM users WHERE lower(email)=lower(%s)", [email]):
            sys.exit("Esiste già un utente con questa e-mail")
        rid = c.val("SELECT id FROM roles WHERE code='admin'")
        uid = c.val("INSERT INTO users(email,full_name,password_hash,role_id,must_change_password) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    [email.lower(), name, security.hash_password(pw), rid, password is None])
        c.exec("INSERT INTO audit_log(action,entity,entity_id,summary) VALUES ('create','user',%s,%s)",
               [str(uid), f"Amministratore {email} creato da riga di comando"])
    print(f"Amministratore creato: {email}")
    if password is None:
        print(f"Password temporanea: {pw}\n(da cambiare al primo accesso)")


def reset_password(email: str):
    pw = _temp_password()
    with db.tx() as c:
        n = c.exec("UPDATE users SET password_hash=%s, must_change_password=true, is_active=true WHERE lower(email)=lower(%s)",
                   [security.hash_password(pw), email])
        if not n:
            sys.exit("Utente non trovato")
        c.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=(SELECT id FROM users WHERE lower(email)=lower(%s))", [email])
    print(f"Nuova password temporanea per {email}: {pw}")


def check():
    with db.read() as c:
        bad_items = c.all("""SELECT i.id, i.name, i.qty_on_hand, COALESCE(sum(m.qty),0) AS moves FROM items i
                             LEFT JOIN stock_movements m ON m.item_id=i.id GROUP BY i.id HAVING i.qty_on_hand <> COALESCE(sum(m.qty),0)""")
        bad_exp = c.all("""SELECT e.id, e.paid_amount, COALESCE(sum(p.amount) FILTER (WHERE p.voided_at IS NULL),0) AS paid
                           FROM expenses e LEFT JOIN expense_payments p ON p.expense_id=e.id GROUP BY e.id
                           HAVING e.paid_amount <> COALESCE(sum(p.amount) FILTER (WHERE p.voided_at IS NULL),0)""")
        bad_sales = c.all("""SELECT s.id FROM sales s WHERE s.gross_total <> COALESCE((SELECT sum(line_total) FROM sale_lines WHERE sale_id=s.id),0)""")
    for label, rows in (("Giacenze incoerenti", bad_items), ("Pagamenti spese incoerenti", bad_exp), ("Vendite incoerenti", bad_sales)):
        print(f"{label}: {len(rows)}")
        for r in rows[:20]:
            print("   ", r)
    sys.exit(1 if bad_items or bad_exp or bad_sales else 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(prog="python -m app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin")
    a.add_argument("--email", required=True)
    a.add_argument("--name", required=True)
    a.add_argument("--password")
    r = sub.add_parser("reset-password")
    r.add_argument("--email", required=True)
    sub.add_parser("check")
    sub.add_parser("migrate")
    args = ap.parse_args()
    if args.cmd == "create-admin":
        create_admin(args.email, args.name, args.password)
    elif args.cmd == "reset-password":
        reset_password(args.email)
    elif args.cmd == "check":
        check()
    else:
        migrate()
