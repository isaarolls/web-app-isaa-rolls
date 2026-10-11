"""Popola un database di PROVA con dati dimostrativi realistici (Isaa Rolls).

    APP_ENV=development python scripts/seed_demo.py

Rifiuta di funzionare in produzione: i dati di prova non devono mai finire nel database reale.
"""
import datetime as dt
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config, db, security  # noqa: E402
from app.common import TZ  # noqa: E402
from app.migrate import migrate  # noqa: E402
from app.services import expenses, purchasing, recipes, sales  # noqa: E402

if config.IS_PROD or os.environ.get("APP_ENV") == "production":
    sys.exit("Rifiutato: non si caricano dati di prova in produzione.")

random.seed(7)
ALL = {"sales.void"}


def main():
    migrate(verbose=False)
    with db.tx() as c:
        if c.val("SELECT count(*) FROM items") > 0:
            sys.exit("Il database contiene già articoli: seed annullato.")
        admin = c.val("SELECT id FROM users ORDER BY id LIMIT 1")
        roles = {r["code"]: r["id"] for r in c.all("SELECT id, code FROM roles")}
        for email, name, role in (("giulia@isaarolls.it", "Giulia Bianchi", "responsabile"), ("marco@isaarolls.it", "Marco Rossi", "vendite")):
            c.exec("INSERT INTO users(email,full_name,password_hash,role_id) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                   [email, name, security.hash_password("ProvaIsaa2026"), roles[role]])
        cat = {r["name"]: r["id"] for r in c.all("SELECT id, name FROM item_categories")}
        pcat = {r["name"]: r["id"] for r in c.all("SELECT id, name FROM product_categories")}
        ecat = {r["name"]: r["id"] for r in c.all("SELECT id, name FROM expense_categories")}
        ch = {r["name"]: r for r in c.all("SELECT * FROM sales_channels")}
        pm = {r["kind"]: r["id"] for r in c.all("SELECT id, kind FROM payment_methods")}
        c.exec("UPDATE sales_channels SET commission_pct=30 WHERE name='Glovo'")
        c.exec("UPDATE accounts SET opening_balance = CASE WHEN kind='cassa' THEN 300 ELSE 12000 END, opening_date=%s",
               [dt.date.today() - dt.timedelta(days=120)])

        sup1 = c.val("INSERT INTO suppliers(legal_name,trade_name,vat_number,phone,email,payment_terms,payment_days,lead_time_days) "
                     "VALUES ('Molino Ciociaro S.r.l.','Molino Ciociaro','01234567890','0775 123456','ordini@molinociociaro.it','Bonifico 30 gg d.f.',30,2) RETURNING id")
        sup2 = c.val("INSERT INTO suppliers(legal_name,vat_number,payment_terms,payment_days,lead_time_days) "
                     "VALUES ('Dolciaria Laziale S.p.A.','09876543210','RiBa 60 gg',60,4) RETURNING id")
        sup3 = c.val("INSERT INTO suppliers(legal_name,payment_terms,payment_days) VALUES ('Pack&Go forniture','Contanti alla consegna',0) RETURNING id")
        landlord = c.val("INSERT INTO suppliers(legal_name) VALUES ('Immobiliare Prati S.r.l.') RETURNING id")

        def item(sku, name, unit, kind, category, min_qty, vat, sup, lots=False):
            return c.val("INSERT INTO items(sku,name,unit_code,kind,category_id,min_qty,vat_rate,default_supplier_id,track_lots) "
                         "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                         [sku, name, unit, kind, cat.get(category), min_qty, vat, sup, lots])

        I = {
            "farina": item("FAR-00", "Farina 00", "kg", "materia_prima", "Farine e impasti", 20, 4, sup1),
            "latte": item("LAT-INT", "Latte intero", "l", "materia_prima", "Latticini e uova", 10, 4, sup2, True),
            "burro": item("BUR-82", "Burro 82%", "kg", "materia_prima", "Latticini e uova", 4, 10, sup2, True),
            "zucchero": item("ZUC-SEM", "Zucchero semolato", "kg", "materia_prima", "Zuccheri", 10, 10, sup1),
            "lievito": item("LIE-BIR", "Lievito di birra", "g", "materia_prima", "Farine e impasti", 200, 4, sup1),
            "cannella": item("CAN-POL", "Cannella in polvere", "g", "materia_prima", "Decorazioni e granelle", 300, 10, sup2),
            "pistacchio": item("CRE-PIS", "Crema al pistacchio", "kg", "materia_prima", "Creme e farciture", 3, 10, sup2),
            "nocciola": item("CRE-NOC", "Crema alla nocciola", "kg", "materia_prima", "Creme e farciture", 3, 10, sup2),
            "granella": item("GRA-PIS", "Granella di pistacchio", "g", "materia_prima", "Decorazioni e granelle", 500, 10, sup2),
            "glassa": item("GLA-ZUC", "Glassa di zucchero", "kg", "materia_prima", "Zuccheri", 2, 10, sup2),
            "confettini": item("DEC-CON", "Confettini colorati", "g", "materia_prima", "Decorazioni e granelle", 300, 10, sup2),
            "box": item("BOX-1", "Box singolo", "pz", "confezione", "Confezioni", 150, 22, sup3),
            "box4": item("BOX-4", "Box da 4", "pz", "confezione", "Confezioni", 40, 22, sup3),
            "tovagliolo": item("TOV-1", "Tovaglioli", "pz", "consumabile", "Materiali di consumo", 500, 22, sup3),
        }
        impasto = item("SEMI-IMP", "Impasto per rolls", "kg", "semilavorato", "Farine e impasti", 0, 4, None)
        c.exec("UPDATE items SET semi_mode='esplodi' WHERE id=%s", [impasto])
        recipes.save_version(c, admin, product_id=None, item_id=impasto, yield_qty=10, notes="Impasto base", valid_from=None, lines_in=[
            {"item_id": I["farina"], "qty": 5.5, "unit_code": "kg"}, {"item_id": I["latte"], "qty": 2.5, "unit_code": "l"},
            {"item_id": I["burro"], "qty": 0.9, "unit_code": "kg"}, {"item_id": I["zucchero"], "qty": 0.7, "unit_code": "kg"},
            {"item_id": I["lievito"], "qty": 120, "unit_code": "g"}])

        start = dt.date.today() - dt.timedelta(days=95)

        def at(d, h=9):
            return dt.datetime.combine(d, dt.time(h, random.randint(0, 59)), tzinfo=TZ)

        prices = {"farina": 0.82, "latte": 1.15, "burro": 7.9, "zucchero": 1.05, "lievito": 0.006, "cannella": 0.028, "pistacchio": 18.5,
                  "nocciola": 11.2, "granella": 0.034, "glassa": 4.2, "confettini": 0.012, "box": 0.18, "box4": 0.45, "tovagliolo": 0.012}
        qty = {"farina": 110, "latte": 50, "burro": 18, "zucchero": 18, "lievito": 2500, "cannella": 1400, "pistacchio": 11, "nocciola": 9,
               "granella": 3000, "glassa": 9, "confettini": 1500, "box": 1100, "box4": 120, "tovagliolo": 3000}
        groups = [(sup1, ["farina", "zucchero", "lievito"]), (sup2, ["latte", "burro", "cannella", "pistacchio", "nocciola", "granella", "glassa", "confettini"]),
                  (sup3, ["box", "box4", "tovagliolo"])]
        for week in range(0, 14):
            d = start + dt.timedelta(days=week * 7)
            for sup, keys in groups:
                if sup == sup3 and week % 3:
                    continue
                mult = 1.0 if week else 1.3
                lines = [{"item_id": I[k], "qty": round(qty[k] * mult * random.uniform(0.85, 1.15), 2),
                          "unit_cost": round(prices[k] * random.uniform(0.95, 1.07), 4)} for k in keys]
                r = purchasing.receive(c, admin, {"supplier_id": sup, "received_at": at(d, 8).isoformat(), "doc_ref": f"DDT {week + 1}/{sup}",
                                                  "lines": lines, "expense": {"create": True, "doc_number": f"FT-{sup}-{week + 1}", "doc_date": d}})
                exp = r["expense"]
                due = exp["due_date"] or d
                if due <= dt.date.today() - dt.timedelta(days=3) or random.random() < 0.2:
                    expenses.add_payment(c, admin, exp["id"], {"paid_at": min(due, dt.date.today()), "amount": None})

        P = {}
        def product(name, price, catname, lines, order):
            pid = c.val("INSERT INTO products(name,sale_price,vat_rate,category_id,sort_order) VALUES (%s,%s,10,%s,%s) RETURNING id",
                        [name, price, pcat[catname], order])
            recipes.save_version(c, admin, product_id=pid, item_id=None, yield_qty=1, notes=None, valid_from=None, lines_in=lines)
            P[name] = pid
        product("Roll classico alla cannella", 4.00, "Rolls", [{"item_id": impasto, "qty": 110, "unit_code": "g"}, {"item_id": I["cannella"], "qty": 3, "unit_code": "g"},
                {"item_id": I["glassa"], "qty": 20, "unit_code": "g"}, {"item_id": I["box"], "qty": 1, "unit_code": "pz"}], 1)
        product("Roll al pistacchio", 5.50, "Rolls", [{"item_id": impasto, "qty": 110, "unit_code": "g"}, {"item_id": I["pistacchio"], "qty": 35, "unit_code": "g"},
                {"item_id": I["granella"], "qty": 6, "unit_code": "g", "waste_pct": 5}, {"item_id": I["box"], "qty": 1, "unit_code": "pz"}], 2)
        product("Roll alla nocciola", 5.00, "Rolls", [{"item_id": impasto, "qty": 110, "unit_code": "g"}, {"item_id": I["nocciola"], "qty": 35, "unit_code": "g"},
                {"item_id": I["box"], "qty": 1, "unit_code": "pz"}], 3)
        product("Ciambella zuccherata", 2.50, "Ciambelle", [{"item_id": impasto, "qty": 80, "unit_code": "g"}, {"item_id": I["zucchero"], "qty": 12, "unit_code": "g"},
                {"item_id": I["tovagliolo"], "qty": 1, "unit_code": "pz"}], 4)
        product("Ciambella glassata", 3.00, "Ciambelle", [{"item_id": impasto, "qty": 80, "unit_code": "g"}, {"item_id": I["glassa"], "qty": 25, "unit_code": "g"},
                {"item_id": I["confettini"], "qty": 4, "unit_code": "g"}, {"item_id": I["tovagliolo"], "qty": 1, "unit_code": "pz"}], 5)
        product("Box 4 rolls misti", 18.00, "Rolls", [{"item_id": impasto, "qty": 440, "unit_code": "g"}, {"item_id": I["pistacchio"], "qty": 40, "unit_code": "g"},
                {"item_id": I["nocciola"], "qty": 40, "unit_code": "g"}, {"item_id": I["glassa"], "qty": 40, "unit_code": "g"}, {"item_id": I["box4"], "qty": 1, "unit_code": "pz"}], 6)

        weights = {"Roll classico alla cannella": 5, "Roll al pistacchio": 4, "Roll alla nocciola": 3, "Ciambella zuccherata": 3, "Ciambella glassata": 2, "Box 4 rolls misti": 1}
        names = list(weights)
        today = dt.date.today()
        d = start
        while d <= today:
            if d.weekday() != 0:  # chiuso il lunedì
                boost = 1.6 if d.weekday() >= 5 else 1.0
                n = int(random.randint(38, 55) * boost) if d < today else 14
                for _ in range(n):
                    k = random.choices(names, weights=[weights[x] for x in names])[0]
                    q = random.choice([1, 1, 1, 2, 2, 3])
                    glovo = random.random() < 0.22
                    hour = random.choice([8, 9, 10, 11, 16, 17, 18, 19, 20])
                    if d == today:
                        hour = min(hour, max(8, dt.datetime.now(TZ).hour - 1))
                    data = {"sold_at": at(d, hour).isoformat(), "channel_id": ch["Glovo"]["id"] if glovo else ch["Vendita diretta"]["id"],
                            "lines": [{"product_id": P[k], "qty": q}],
                            "discount": 0.5 if (not glovo and random.random() < 0.05) else 0}
                    if not glovo:
                        method = pm["contanti"] if random.random() < 0.45 else pm["carta"]
                        gross = None
                        data["payments"] = None
                        s = sales.create_sale(c, admin, ALL, {**data, "payments": [{"method_id": method, "amount": _gross(c, P[k], q, data["discount"])}]})
                    else:
                        sales.create_sale(c, admin, ALL, data)
            d += dt.timedelta(days=1)

        # accrediti Glovo settimanali (fino a 7 giorni fa)
        bank = c.val("SELECT id FROM accounts WHERE kind='banca'")
        wk = start + dt.timedelta(days=13)
        while wk <= today - dt.timedelta(days=3):
            rows = c.all("""SELECT sp.id, sp.amount, s.commission_gross FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
                            WHERE sp.status='in_attesa' AND s.business_date <= %s""", [wk - dt.timedelta(days=6)])
            if rows:
                amt = sum(float(r["amount"]) - float(r["commission_gross"]) for r in rows)
                sales.settle(c, admin, [r["id"] for r in rows], wk, bank, round(amt, 2), ch["Glovo"]["id"], "Bonifico settimanale Glovo")
            wk += dt.timedelta(days=7)

        # versamenti contanti in banca
        cassa = c.val("SELECT id FROM accounts WHERE kind='cassa'")
        wk = start + dt.timedelta(days=6)
        import uuid
        while wk <= today:
            g = str(uuid.uuid4())
            c.exec("INSERT INTO cash_movements(account_id,moved_at,amount,kind,transfer_group,description,user_id) VALUES (%s,%s,-900,'giroconto',%s,'Versamento contanti',%s)", [cassa, wk, g, admin])
            c.exec("INSERT INTO cash_movements(account_id,moved_at,amount,kind,transfer_group,description,user_id) VALUES (%s,%s,900,'giroconto',%s,'Versamento contanti',%s)", [bank, wk, g, admin])
            wk += dt.timedelta(days=7)

        # spese ricorrenti e varie
        def rec(desc, catname, net, vat, sup=None, day=5):
            c.exec("INSERT INTO recurring_expenses(description,category_id,supplier_id,net_amount,vat_rate,frequency,day_of_month,start_date,due_days) "
                   "VALUES (%s,%s,%s,%s,%s,'mensile',%s,%s,5)", [desc, ecat[catname], sup, net, vat, day, start.replace(day=1)])
        rec("Affitto locale", "Affitto", 1400, 0, landlord, 1)
        rec("Commercialista", "Commercialista", 180, 22, None, 10)
        rec("Fibra e telefono", "Internet e telefonia", 39.9, 22, None, 15)
        rec("Stipendi collaboratori", "Stipendi e collaboratori", 3200, 0, None, 27)
        rec("Contributi INPS/INAIL", "Contributi e oneri del personale", 980, 0, None, 16)
        expenses.generate_recurring(c, horizon_days=10)
        for e in c.all("SELECT id, due_date FROM expenses WHERE recurring_id IS NOT NULL AND due_date < %s", [today - dt.timedelta(days=2)]):
            expenses.add_payment(c, admin, e["id"], {"paid_at": e["due_date"], "amount": None})
        m = start.replace(day=1)
        while m <= today:
            for desc, catname, net in (("Energia elettrica", "Utenze elettriche", random.uniform(380, 520)), ("Gas e acqua", "Acqua e gas", random.uniform(90, 160)),
                                       ("Sponsorizzate social", "Marketing e pubblicità", random.uniform(80, 200))):
                dd = m + dt.timedelta(days=19)
                if dd > today:
                    continue
                e = expenses.create(c, admin, {"description": f"{desc} {m.strftime('%m/%Y')}", "category_id": ecat[catname], "doc_date": dd,
                                               "net_amount": round(net, 2), "vat_rate": 22, "due_date": dd + dt.timedelta(days=15)})
                if dd + dt.timedelta(days=15) < today:
                    expenses.add_payment(c, admin, e["id"], {"paid_at": dd + dt.timedelta(days=14), "amount": None})
            m = (m + dt.timedelta(days=32)).replace(day=1)
        forno = c.val("INSERT INTO expense_categories(name,pl_group,amortization_months) VALUES ('Forno e attrezzature (36 mesi)','investimenti',36) RETURNING id")
        expenses.create(c, admin, {"description": "Forno ventilato professionale", "category_id": forno, "doc_date": start + dt.timedelta(days=3),
                                   "net_amount": 5400, "vat_rate": 22, "paid_now": True, "paid_at": start + dt.timedelta(days=3), "doc_number": "F-2041"})

        # sprechi e un inventario
        from app.services import stock
        for k, q, w in (("pistacchio", 0.2, "scaduto"), ("latte", 1.5, "scaduto"), ("box", 12, "danneggiato")):
            stock.move(c, admin, I[k], -q, "spreco", reason="Controllo settimanale", waste_reason=w, at=at(today - dt.timedelta(days=4), 18))
        stock.move(c, admin, I["latte"], 6, "acquisto", unit_cost=1.12, reason="Latte fresco", lot_code="L2410", expiry_date=today + dt.timedelta(days=2),
                   at=at(today - dt.timedelta(days=1), 8))
    print("Dati dimostrativi caricati. Utenti di prova: giulia@isaarolls.it (responsabile), marco@isaarolls.it (dipendente), password ProvaIsaa2026")


def _gross(c, pid, q, disc):
    price = float(c.val("SELECT sale_price FROM products WHERE id=%s", [pid]))
    return round(price * q - disc, 2)


if __name__ == "__main__":
    main()
