"""Test di integrazione: API + database reale.

Ogni test usa articoli propri e un mese passato diverso, così i risultati sono indipendenti.
"""
import concurrent.futures as cf
import datetime as dt
import io
import uuid
from decimal import Decimal as Dec

import requests
from openpyxl import Workbook

from tests.helpers import ADMIN, ApiTest, Client, Server, TEST_DB

from app import db


def uid():
    return uuid.uuid4().hex[:6].upper()


class Base(ApiTest):
    def item(self, name, unit="kg", kind="materia_prima", qty=None, cost=None, **kw):
        body = {"sku": f"{name[:3].upper()}-{uid()}", "name": f"{name} {uid()}", "unit_code": unit, "kind": kind, **kw}
        if qty:
            body.update(initial_qty=str(qty), initial_cost=str(cost or 0))
        return self.admin.post("/items", body)

    def load(self, item_id, qty, cost, at=None):
        return self.admin.post("/movements", {"item_id": item_id, "type": "acquisto", "qty": str(qty), "unit_cost": str(cost),
                                              "reason": "Carico test", "at": at})

    def channel(self, name="Vendita diretta"):
        return self.lookup("channels", name)

    def method(self, name):
        return self.lookup("payment-methods", name)

    def pl(self, d1, d2):
        return self.admin.get(f"/reports/pl?from={d1}&to={d2}")

    def line(self, pl, key):
        return Dec(str(next(l for l in pl["lines"] if l["key"] == key)["amount"]))

    def roll_setup(self):
        """Prepara articoli, semilavorato e prodotto con ricetta (vedi valori attesi nei test)."""
        farina = self.item("Farina")
        self.load(farina["id"], 10, "1.00")
        self.load(farina["id"], 10, "2.00")           # costo medio 1,50
        latte = self.item("Latte", unit="l")
        self.load(latte["id"], 10, "1.00")
        crema = self.item("Crema")
        self.load(crema["id"], 5, "8.00")
        box = self.item("Box", unit="pz", kind="confezione")
        self.load(box["id"], 100, "0.20")
        impasto = self.item("Impasto", kind="semilavorato", semi_mode="esplodi")
        self.admin.post(f"/items/{impasto['id']}/recipe", {"yield_qty": "1", "lines": [
            {"item_id": farina["id"], "qty": "600", "unit_code": "g"},
            {"item_id": latte["id"], "qty": "400", "unit_code": "ml"}]})
        prod = self.admin.post("/products", {"name": f"Roll {uid()}", "sale_price": "5.50", "vat_rate": "10", "track_stock": False})
        self.admin.post(f"/products/{prod['id']}/recipe", {"lines": [
            {"item_id": impasto["id"], "qty": "100", "unit_code": "g"},
            {"item_id": crema["id"], "qty": "25", "unit_code": "g"},
            {"item_id": box["id"], "qty": "1", "unit_code": "pz"}]})
        return dict(farina=farina, latte=latte, crema=crema, box=box, impasto=impasto, prod=prod)

    def make_user(self, role_code):
        roles = {r["code"]: r["id"] for r in self.admin.get("/roles")}
        email = f"{role_code}.{uid().lower()}@test.local"
        res = self.admin.post("/users", {"email": email, "full_name": f"Utente {role_code}", "role_id": roles[role_code],
                                         "password": "PasswordTest2026"})
        # primo accesso: cambio password obbligatorio
        c = Client(email, "PasswordTest2026")
        c.get("/items", expect=403)
        c.post("/auth/change-password", {"current_password": "PasswordTest2026", "new_password": "NuovaPassword2026"})
        return Client(email, "NuovaPassword2026"), res["id"]

    def qty(self, item_id):
        return Dec(str(self.admin.get(f"/items/{item_id}")["qty_on_hand"]))


class TestAutenticazione(Base):
    def test_login_errato(self):
        r = requests.post(Server.url + "/api/auth/login", json={"email": ADMIN[0], "password": "sbagliata"})
        self.assertEqual(r.status_code, 401)

    def test_senza_sessione(self):
        r = requests.get(Server.url + "/api/items")
        self.assertEqual(r.status_code, 401)

    def test_csrf_cookie(self):
        s = requests.Session()
        s.post(Server.url + "/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
        r = s.post(Server.url + "/api/lookups/item-categories", json={"name": "X" + uid()})
        self.assertEqual(r.status_code, 403)
        r = s.post(Server.url + "/api/lookups/item-categories", json={"name": "X" + uid()},
                   headers={"X-Requested-With": "IsaManager"})
        self.assertEqual(r.status_code, 200)

    def test_logout_invalida_token(self):
        c = Client()
        c.post("/auth/logout")
        c.get("/auth/me", expect=401)


class TestPermessi(Base):
    def test_addetto_vendite(self):
        c, _ = self.make_user("vendite")
        c.get("/reports/pl", expect=403)
        c.get("/expenses", expect=403)
        c.post("/expenses", {"description": "x", "category_id": 1, "doc_date": "2026-01-01", "net_amount": "1"}, expect=403)
        prod = self.admin.post("/products", {"name": f"P {uid()}", "sale_price": "3", "vat_rate": "10", "unload_stock": False})
        c.get("/users", expect=403)
        c.get("/dashboard", expect=403)
        c.get("/items", expect=403)
        c.get("/sales", expect=403)
        c.get("/receivables", expect=403)
        self.assertTrue(c.get("/products"))  # vede solo l'elenco prodotti per la cassa
        s = c.post("/sales", {"channel_id": self.channel()["id"], "lines": [{"product_id": prod["id"], "qty": "1"}]})
        self.assertEqual(Dec(str(s["gross_total"])), Dec("3.00"))
        c.post(f"/sales/{s['id']}/void", {"reason": "prova"}, expect=403)

    def test_responsabile_accesso_completo(self):
        c, _ = self.make_user("responsabile")
        for path in ("/reports/pl", "/users", "/audit", "/items", "/expenses", "/dashboard"):
            c.get(path)

    def test_addetto_magazzino_senza_costi(self):
        c, _ = self.make_user("magazzino")
        it = self.item("Zucchero", qty=5, cost=2)
        row = c.get(f"/items/{it['id']}")
        self.assertNotIn("avg_cost", row)
        self.assertNotIn("stock_value", row)
        c.post("/movements", {"item_id": it["id"], "type": "scarico", "qty": "1", "reason": "uso"})
        c.get("/reports/pl", expect=403)
        c.get("/sales", expect=403)

    def test_eccezione_permesso_utente(self):
        c, user_id = self.make_user("vendite")
        u = next(x for x in self.admin.get("/users") if x["id"] == user_id)
        self.admin.put(f"/users/{user_id}", {"email": u["email"], "full_name": u["full_name"], "role_id": u["role_id"],
                                             "overrides": [{"permission": "reports.view", "granted": True},
                                                           {"permission": "sales.create", "granted": False}]})
        c.get("/reports/pl")
        prod = self.admin.post("/products", {"name": f"P {uid()}", "sale_price": "3", "vat_rate": "10"})
        c.post("/sales", {"channel_id": self.channel()["id"], "lines": [{"product_id": prod["id"]}]}, expect=403)

    def test_utente_disattivato(self):
        c, user_id = self.make_user("vendite")
        u = next(x for x in self.admin.get("/users") if x["id"] == user_id)
        self.admin.put(f"/users/{user_id}", {"email": u["email"], "full_name": u["full_name"], "role_id": u["role_id"],
                                             "is_active": False})
        c.get("/auth/me", expect=401)


class TestMagazzino(Base):
    def test_costo_medio_e_storico(self):
        it = self.item("Burro")
        self.load(it["id"], 10, "2.00")
        self.load(it["id"], 10, "4.00")
        row = self.admin.get(f"/items/{it['id']}")
        self.assertEqual(Dec(str(row["avg_cost"])), Dec("3"))
        mv = self.admin.post("/movements", {"item_id": it["id"], "type": "scarico", "qty": "5", "reason": "consumo"})
        self.assertEqual(Dec(str(mv["value"])), Dec("-15"))
        self.assertEqual(self.qty(it["id"]), Dec("15"))
        # spreco con motivo obbligatorio
        self.admin.post("/movements", {"item_id": it["id"], "type": "spreco", "qty": "1", "reason": "caduto"}, expect=422)
        self.admin.post("/movements", {"item_id": it["id"], "type": "spreco", "qty": "1", "reason": "caduto",
                                       "waste_reason": "danneggiato"})
        # conversione di unità: 500 g su articolo in kg
        self.admin.post("/movements", {"item_id": it["id"], "type": "scarico", "qty": "500", "qty_unit": "g", "reason": "uso"})
        self.assertEqual(self.qty(it["id"]), Dec("13.5"))
        moves = self.admin.get(f"/movements?item_id={it['id']}")
        self.assertEqual(len(moves), 5)
        self.assertTrue(all(m["user_name"] and m["reason"] for m in moves))

    def test_storno_e_immutabilita(self):
        it = self.item("Panna")
        mv = self.load(it["id"], 4, "3.00")
        self.admin.post(f"/movements/{mv['id']}/reverse", {"reason": "carico errato"})
        self.assertEqual(self.qty(it["id"]), Dec("0"))
        self.admin.post(f"/movements/{mv['id']}/reverse", {"reason": "di nuovo"}, expect=409)
        # il database rifiuta modifiche/cancellazioni dirette dei movimenti
        with self.assertRaises(Exception):
            with db.tx() as c:
                c.exec("UPDATE stock_movements SET qty=1 WHERE id=%s", [mv["id"]])
        with self.assertRaises(Exception):
            with db.tx() as c:
                c.exec("DELETE FROM stock_movements WHERE id=%s", [mv["id"]])
        self.assertEqual(len(self.admin.get(f"/movements?item_id={it['id']}")), 2)

    def test_inventario_fisico(self):
        a = self.item("Cacao", qty=10, cost="5")
        b = self.item("Vaniglia", qty=2, cost="10")
        cat = self.lookup("item-categories", "Decorazioni e granelle")
        self.admin.put(f"/items/{a['id']}", {**{k: a[k] for k in ("sku", "name", "unit_code", "kind")}, "category_id": cat["id"]})
        self.admin.put(f"/items/{b['id']}", {**{k: b[k] for k in ("sku", "name", "unit_code", "kind")}, "category_id": cat["id"]})
        cnt = self.admin.post("/counts", {"category_id": cat["id"]})
        self.admin.post("/counts", {}, expect=409)  # un solo inventario aperto alla volta
        self.admin.put(f"/counts/{cnt['id']}", {"lines": [{"item_id": a["id"], "counted_qty": "8,5"},
                                                         {"item_id": b["id"], "counted_qty": "2"}]})
        res = self.admin.post(f"/counts/{cnt['id']}/confirm")
        self.assertEqual(res["adjustments"], 1)
        self.assertEqual(self.qty(a["id"]), Dec("8.5"))
        self.assertEqual(Dec(str(res["value"])), Dec("-7.5"))

    def test_lotti_e_scadenze(self):
        it = self.item("Fragole", track_lots=True)
        soon = (dt.date.today() + dt.timedelta(days=2)).isoformat()
        later = (dt.date.today() + dt.timedelta(days=30)).isoformat()
        self.admin.post("/movements", {"item_id": it["id"], "type": "acquisto", "qty": "3", "unit_cost": "4", "reason": "carico",
                                       "lot_code": "L2", "expiry_date": later})
        self.admin.post("/movements", {"item_id": it["id"], "type": "acquisto", "qty": "2", "unit_cost": "4", "reason": "carico",
                                       "lot_code": "L1", "expiry_date": soon})
        alerts = self.admin.get("/inventory/alerts")
        self.assertTrue(any(e["item_id"] == it["id"] and e["lot_code"] == "L1" for e in alerts["expiring"]))
        # lo scarico consuma prima il lotto che scade prima (FEFO)
        self.admin.post("/movements", {"item_id": it["id"], "type": "scarico", "qty": "2", "reason": "uso"})
        lots = {l["lot_code"]: Dec(str(l["qty_remaining"])) for l in self.admin.get(f"/items/{it['id']}")["lots"]}
        self.assertEqual(lots, {"L2": Dec("3")})

    def test_scorta_minima(self):
        it = self.item("Granella", qty=1, cost=3, min_qty="2")
        self.assertTrue(any(x["id"] == it["id"] for x in self.admin.get("/inventory/alerts")["low_stock"]))

    def test_concorrenza_vendite_simultanee(self):
        it = self.item("Zucchero velo", unit="g", qty=10000, cost="0.002")
        prod = self.admin.post("/products", {"name": f"Ciambella {uid()}", "sale_price": "2.00", "vat_rate": "10", "track_stock": False})
        self.admin.post(f"/products/{prod['id']}/recipe", {"lines": [{"item_id": it["id"], "qty": "15", "unit_code": "g"}]})
        clients = [Client() for _ in range(4)]
        ch = self.channel()["id"]

        def sell(i):
            return clients[i % 4].post("/sales", {"channel_id": ch, "lines": [{"product_id": prod["id"], "qty": "1"}]})

        with cf.ThreadPoolExecutor(8) as ex:
            res = list(ex.map(sell, range(40)))
        self.assertEqual(len({r["number"] for r in res}), 40)
        self.assertEqual(self.qty(it["id"]), Dec(10000 - 40 * 15))
        with db.tx() as c:
            s = c.val("SELECT sum(qty) FROM stock_movements WHERE item_id=%s", [it["id"]])
        self.assertEqual(Dec(s), Dec(10000 - 40 * 15))


class TestRicetteVenditeReport(Base):
    def test_scheda_costo(self):
        x = self.roll_setup()
        p = self.admin.get(f"/products/{x['prod']['id']}")
        card = p["card"]
        self.assertEqual(Dec(str(card["unit_cost"])), Dec("0.53"))
        self.assertEqual(Dec(str(card["packaging_cost"])), Dec("0.2"))
        self.assertEqual(Dec(str(card["materials_cost"])), Dec("0.33"))
        self.assertEqual(Dec(str(card["net_price"])), Dec("5.00"))
        self.assertEqual(Dec(str(card["gross_margin"])), Dec("4.47"))
        self.assertEqual(Dec(str(card["food_cost_pct"])), Dec("10.60"))
        self.assertEqual(Dec(str(card["suggested_price"])), Dec("1.94"))  # margine obiettivo 70%

    def test_versioni_ricetta_non_alterano_il_passato(self):
        x = self.roll_setup()
        ch = self.channel()["id"]
        s1 = self.admin.post("/sales", {"channel_id": ch, "sold_at": "2025-02-10T10:00:00",
                                        "lines": [{"product_id": x["prod"]["id"], "qty": "1"}]})
        self.assertEqual(Dec(str(s1["cost_total"])), Dec("0.53"))
        # nuova versione: doppia crema
        self.admin.post(f"/products/{x['prod']['id']}/recipe", {"lines": [
            {"item_id": x["impasto"]["id"], "qty": "100", "unit_code": "g"},
            {"item_id": x["crema"]["id"], "qty": "50", "unit_code": "g"},
            {"item_id": x["box"]["id"], "qty": "1", "unit_code": "pz"}]})
        s2 = self.admin.post("/sales", {"channel_id": ch, "lines": [{"product_id": x["prod"]["id"], "qty": "1"}]})
        self.assertEqual(Dec(str(s2["cost_total"])), Dec("0.73"))
        self.assertEqual(Dec(str(self.admin.get(f"/sales/{s1['id']}")["cost_total"])), Dec("0.53"))
        self.assertEqual(len(self.admin.get(f"/products/{x['prod']['id']}")["versions"]), 2)

    def test_vendita_aggiorna_magazzino_e_report(self):
        x = self.roll_setup()
        d = "2025-03-10T11:30:00"
        s = self.admin.post("/sales", {"channel_id": self.channel()["id"], "sold_at": d,
                                       "lines": [{"product_id": x["prod"]["id"], "qty": "2"}]})
        self.assertEqual(Dec(str(s["gross_total"])), Dec("11.00"))
        self.assertEqual(Dec(str(s["net_total"])), Dec("10.00"))
        self.assertEqual(self.qty(x["farina"]["id"]), Dec("19.88"))
        self.assertEqual(self.qty(x["latte"]["id"]), Dec("9.92"))
        self.assertEqual(self.qty(x["crema"]["id"]), Dec("4.95"))
        self.assertEqual(self.qty(x["box"]["id"]), Dec("98"))
        pl = self.pl("2025-03-01", "2025-03-31")
        self.assertEqual(self.line(pl, "ricavi"), Dec("10.00"))
        self.assertEqual(self.line(pl, "materie_prime"), Dec("1.06"))
        self.assertEqual(self.line(pl, "margine_lordo"), Dec("8.94"))
        self.assertEqual(Dec(str(pl["vat"]["output"])), Dec("1.00"))
        self.assertTrue(all(c["ok"] or c.get("warning") for c in pl["checks"]), pl["checks"])
        # il dettaglio di ogni numero coincide con il totale mostrato
        for metric, key in (("sales", "ricavi"), ("materials", "materie_prime")):
            dr = self.admin.get(f"/drill?metric={metric}&from=2025-03-01&to=2025-03-31")
            self.assertEqual(Dec(str(dr["total"])), self.line(pl, key), metric)
        # annullamento: magazzino ripristinato e report a zero
        self.admin.post(f"/sales/{s['id']}/void", {"reason": "errore di battitura"})
        self.assertEqual(self.qty(x["farina"]["id"]), Dec("20"))
        self.assertEqual(self.qty(x["box"]["id"]), Dec("100"))
        pl = self.pl("2025-03-01", "2025-03-31")
        self.assertEqual(self.line(pl, "ricavi"), Dec("0"))
        self.assertEqual(self.line(pl, "materie_prime"), Dec("0"))
        log = self.admin.get(f"/audit?entity=sale&entity_id={s['id']}")
        self.assertTrue(any(a["action"] == "void" for a in log))

    def test_sconti_pagamenti_misti_e_rimborso(self):
        prod = self.admin.post("/products", {"name": f"Roll {uid()}", "sale_price": "4.50", "vat_rate": "10", "unload_stock": False})
        ch = self.channel()["id"]
        cash, card = self.method("Contanti")["id"], self.method("Carta / POS")["id"]
        self.admin.post("/sales", {"channel_id": ch, "sold_at": "2025-04-05T12:00:00",
                                   "lines": [{"product_id": prod["id"], "qty": "3"}], "discount": "1.50",
                                   "payments": [{"method_id": cash, "amount": "5"}, {"method_id": card, "amount": "6"}]}, expect=422)
        s = self.admin.post("/sales", {"channel_id": ch, "sold_at": "2025-04-05T12:00:00",
                                       "lines": [{"product_id": prod["id"], "qty": "3"}], "discount": "1.50",
                                       "payments": [{"method_id": cash, "amount": "5"}, {"method_id": card, "amount": "7"}]})
        self.assertEqual(Dec(str(s["gross_total"])), Dec("12.00"))
        self.assertEqual(Dec(str(s["discount_total"])), Dec("1.50"))
        r = self.admin.post(f"/sales/{s['id']}/refund", {"amount": "4", "method_id": cash, "reason": "prodotto rovinato",
                                                         "at": "2025-04-06T10:00:00"})
        self.admin.post(f"/sales/{s['id']}/refund", {"amount": "9", "method_id": cash, "reason": "troppo"}, expect=422)
        pl = self.pl("2025-04-01", "2025-04-30")
        self.assertEqual(self.line(pl, "vendite_lorde"), Dec("13.50"))
        self.assertEqual(self.line(pl, "sconti"), Dec("1.50"))
        self.assertEqual(self.line(pl, "rimborsi"), Dec("4.00"))
        self.assertEqual(Dec(str(pl["totals"]["gross_sales"])), Dec("8.00"))
        self.assertEqual(self.line(pl, "ricavi"), Dec("7.27"))  # 10,91 − 3,64
        liq = pl["liquidity"]
        self.assertEqual(Dec(str(liq["inflows_sales"])), Dec("8.00"))

    def test_piattaforma_credito_e_accredito(self):
        glovo = self.channel("Glovo")
        self.admin.put(f"/lookups/channels/{glovo['id']}", {"commission_pct": "30"})
        prod = self.admin.post("/products", {"name": f"Box {uid()}", "sale_price": "10.00", "vat_rate": "10", "unload_stock": False})
        s1 = self.admin.post("/sales", {"channel_id": glovo["id"], "sold_at": "2025-05-03T19:00:00",
                                        "lines": [{"product_id": prod["id"], "qty": "1"}]})
        s2 = self.admin.post("/sales", {"channel_id": glovo["id"], "sold_at": "2025-05-04T19:00:00",
                                        "lines": [{"product_id": prod["id"], "qty": "2"}]})
        self.assertEqual(Dec(str(s1["commission_gross"])), Dec("3.00"))
        pl = self.pl("2025-05-01", "2025-05-31")
        self.assertEqual(Dec(str(pl["liquidity"]["receivables"])), Dec("30.00"))
        self.assertEqual(Dec(str(pl["liquidity"]["inflows"])), Dec("0"))
        self.assertEqual(self.line(pl, "costi_variabili"), Dec("7.38"))  # 9,00 € IVA 22% inclusa → 7,38 netti
        pend = [p for p in self.admin.get("/receivables") if p["sale_id"] in (s1["id"], s2["id"])]
        self.assertEqual(len(pend), 2)
        bank = self.lookup("accounts", "Conto corrente")
        bal0 = Dec(str(next(a for a in self.admin.get("/accounts/balances") if a["id"] == bank["id"])["balance"]))
        st = self.admin.post("/settlements", {"payment_ids": [p["id"] for p in pend], "received_at": "2025-05-20",
                                              "account_id": bank["id"], "amount": "21.00", "channel_id": glovo["id"]})
        pl = self.pl("2025-05-01", "2025-05-31")
        self.assertEqual(Dec(str(pl["liquidity"]["receivables"])), Dec("0"))
        self.assertEqual(Dec(str(pl["liquidity"]["inflows"])), Dec("21.00"))
        bal1 = Dec(str(next(a for a in self.admin.get("/accounts/balances") if a["id"] == bank["id"])["balance"]))
        self.assertEqual(bal1 - bal0, Dec("21.00"))
        self.admin.post(f"/sales/{s1['id']}/void", {"reason": "prova annullo"}, expect=409)  # già riconciliata
        self.admin.post(f"/settlements/{st['id']}/void")
        self.assertEqual(Dec(str(self.pl("2025-05-01", "2025-05-31")["liquidity"]["receivables"])), Dec("30.00"))
        self.admin.put(f"/lookups/channels/{glovo['id']}", {"commission_pct": "0"})


class TestAcquistiSpese(Base):
    def test_acquisto_senza_doppio_conteggio(self):
        sup = self.admin.post("/suppliers", {"legal_name": f"Molino {uid()}", "payment_days": 30})
        far = self.item("Farina T", qty=None)
        r = self.admin.post("/receipts", {"supplier_id": sup["id"], "received_at": "2025-06-03T09:00:00", "doc_ref": "DDT 12",
                                          "lines": [{"item_id": far["id"], "qty": "25", "unit_cost": "0.80", "vat_rate": "4"}],
                                          "expense": {"create": True, "doc_number": "F-55"}})
        self.assertIsNotNone(r["expense_id"])
        e = self.admin.get(f"/expenses/{r['expense_id']}")
        self.assertEqual(Dec(str(e["net_amount"])), Dec("20.00"))
        self.assertEqual(Dec(str(e["vat_amount"])), Dec("0.80"))
        self.assertEqual(e["due_date"], "2025-07-03")
        self.assertEqual(self.qty(far["id"]), Dec("25"))
        pl = self.pl("2025-06-01", "2025-06-30")
        # l'acquisto non è un costo finché la farina non viene consumata
        self.assertEqual(self.line(pl, "materie_prime"), Dec("0"))
        self.assertEqual(self.line(pl, "altri_operativi"), Dec("0"))
        self.assertEqual(Dec(str(pl["excluded"]["acquisti_magazzino"])), Dec("20.00"))
        self.assertEqual(Dec(str(pl["vat"]["input"])), Dec("0.80"))
        self.admin.post("/movements", {"item_id": far["id"], "type": "scarico", "qty": "5", "reason": "produzione",
                                       "at": "2025-06-10T08:00:00"})
        pl = self.pl("2025-06-01", "2025-06-30")
        self.assertEqual(self.line(pl, "materie_prime"), Dec("4.00"))
        payable0 = Dec(str(pl["liquidity"]["payables"]))
        self.assertGreaterEqual(payable0, Dec("20.80"))
        self.admin.post(f"/expenses/{r['expense_id']}/payments", {"paid_at": "2025-06-25", "amount": "10"})
        self.assertEqual(self.admin.get(f"/expenses/{r['expense_id']}")["status"], "parziale")
        self.admin.post(f"/expenses/{r['expense_id']}/payments", {"paid_at": "2025-06-26", "amount": "11"}, expect=422)
        self.admin.post(f"/expenses/{r['expense_id']}/payments", {"paid_at": "2025-06-26"})
        self.assertEqual(self.admin.get(f"/expenses/{r['expense_id']}")["status"], "pagata")
        pl = self.pl("2025-06-01", "2025-06-30")
        self.assertEqual(Dec(str(pl["liquidity"]["payables"])), payable0 - Dec("20.80"))
        self.assertEqual(Dec(str(pl["liquidity"]["outflows_expenses"])), Dec("20.80"))
        # non si può annullare il ricevimento se c'è una spesa collegata
        self.admin.post(f"/receipts/{r['id']}/void", {"reason": "errore"}, expect=409)

    def test_ordine_ricevimento_parziale(self):
        sup = self.admin.post("/suppliers", {"legal_name": f"Dolciaria {uid()}"})
        crema = self.item("Crema pistacchio")
        po = self.admin.post("/purchase-orders", {"supplier_id": sup["id"], "order_date": "2025-07-01",
                                                  "lines": [{"item_id": crema["id"], "qty_ordered": "10", "unit_price": "12"}]})
        self.admin.post("/receipts", {"po_id": po["id"], "lines": [{"item_id": crema["id"], "qty": "4", "unit_cost": "12"}]}, expect=422)
        self.admin.post(f"/purchase-orders/{po['id']}/status", {"status": "inviato"})
        self.assertEqual(self.qty(crema["id"]), Dec("0"))  # il magazzino si aggiorna solo al ricevimento
        pol = self.admin.get(f"/purchase-orders/{po['id']}")["lines"][0]
        self.admin.post("/receipts", {"po_id": po["id"], "lines": [{"item_id": crema["id"], "qty": "4", "unit_cost": "12", "po_line_id": pol["id"]}]})
        self.assertEqual(self.admin.get(f"/purchase-orders/{po['id']}")["status"], "parziale")
        self.admin.post("/receipts", {"po_id": po["id"], "lines": [{"item_id": crema["id"], "qty": "6", "unit_cost": "12.5", "po_line_id": pol["id"]}]})
        self.assertEqual(self.admin.get(f"/purchase-orders/{po['id']}")["status"], "ricevuto")
        self.assertEqual(self.qty(crema["id"]), Dec("10"))
        self.assertEqual(Dec(str(self.admin.get(f"/items/{crema['id']}")["avg_cost"])), Dec("12.3"))

    def test_spese_costi_fissi_ripartiti(self):
        cat = self.lookup("expense-categories", "Affitto")
        self.admin.post("/expenses", {"description": "Affitto agosto", "category_id": cat["id"], "doc_date": "2025-08-01",
                                      "net_amount": "1550", "vat_rate": "0"})
        pl = self.pl("2025-08-01", "2025-08-31")
        self.assertEqual(self.line(pl, "costi_fissi"), Dec("1550.00"))
        day = self.pl("2025-08-10", "2025-08-10")
        self.assertTrue(day["prorated"])
        self.assertEqual(self.line(day, "costi_fissi"), Dec("50.00"))
        dr = self.admin.get("/drill?metric=group:costi_fissi&from=2025-08-01&to=2025-08-31")
        self.assertEqual(Dec(str(dr["total"])), Dec("1550.00"))

    def test_iva_indetraibile_e_ammortamento(self):
        cat = self.admin.post("/lookups/expense-categories", {"name": f"Forno {uid()}", "pl_group": "investimenti",
                                                              "amortization_months": 10})
        self.admin.post("/expenses", {"description": "Forno", "category_id": cat["id"], "doc_date": "2025-09-15",
                                      "net_amount": "1000", "vat_rate": "22"})
        self.assertEqual(self.line(self.pl("2025-09-01", "2025-09-30"), "altri_operativi"), Dec("100.00"))
        self.assertEqual(self.line(self.pl("2026-01-01", "2026-01-31"), "altri_operativi"), Dec("100.00"))
        tel = self.lookup("expense-categories", "Internet e telefonia")
        self.admin.post("/expenses", {"description": "Tel", "category_id": tel["id"], "doc_date": "2025-10-05",
                                      "net_amount": "100", "vat_rate": "22", "vat_deductible": False})
        self.assertEqual(self.line(self.pl("2025-10-01", "2025-10-31"), "costi_fissi"), Dec("122.00"))

    def test_ricorrenti_senza_falsi_pagamenti(self):
        cat = self.lookup("expense-categories", "Assicurazioni")
        r = self.admin.post("/recurring", {"description": f"Polizza {uid()}", "category_id": cat["id"], "net_amount": "80",
                                           "vat_rate": "0", "frequency": "mensile", "day_of_month": 5,
                                           "start_date": "2025-11-01", "end_date": "2026-01-31"})
        self.assertEqual(r["generated"], 3)
        again = self.admin.post("/recurring/generate")
        self.assertEqual(again["generated"], 0)
        rows = [e for e in self.admin.get("/expenses?from=2025-11-01&to=2026-01-31") if e["recurring_id"] == r["id"]]
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(e["status"] == "da_pagare" and Dec(str(e["paid_amount"])) == 0 for e in rows))

    def test_allegato(self):
        cat = self.lookup("expense-categories", "Commercialista")
        e = self.admin.post("/expenses", {"description": "Parcella", "category_id": cat["id"], "doc_date": "2025-12-01",
                                          "total_amount": "122", "vat_rate": "22"})
        self.assertEqual(Dec(str(e["net_amount"])), Dec("100.00"))
        pdf = b"%PDF-1.4\n%test\n"
        self.admin.req("POST", f"/attachments/expense/{e['id']}", files={"file": ("doc.exe", b"MZ....", "application/pdf")}, expect=422)
        a = self.admin.req("POST", f"/attachments/expense/{e['id']}", files={"file": ("parcella.pdf", pdf, "application/pdf")})
        got = self.admin.get(f"/attachments/{a['id']}")
        self.assertEqual(got.content, pdf)
        self.assertEqual(len(self.admin.get(f"/expenses/{e['id']}")["attachments"]), 1)


class TestChiusure(Base):
    def test_chiusura_mese(self):
        prod = self.admin.post("/products", {"name": f"P {uid()}", "sale_price": "2", "vat_rate": "10", "unload_stock": False})
        ch = self.channel()["id"]
        self.admin.post("/sales", {"channel_id": ch, "sold_at": "2024-02-10T10:00:00", "lines": [{"product_id": prod["id"]}]})
        self.admin.post("/periods/2024-02/close")
        self.admin.post("/sales", {"channel_id": ch, "sold_at": "2024-02-11T10:00:00", "lines": [{"product_id": prod["id"]}]}, expect=409)
        cat = self.lookup("expense-categories", "Affitto")
        self.admin.post("/expenses", {"description": "spesa prova", "category_id": cat["id"], "doc_date": "2024-02-01", "net_amount": "1"}, expect=409)
        self.admin.req("DELETE", "/periods/2024-02/close")
        self.admin.post("/sales", {"channel_id": ch, "sold_at": "2024-02-11T10:00:00", "lines": [{"product_id": prod["id"]}]})

    def test_chiusura_cassa(self):
        prod = self.admin.post("/products", {"name": f"P {uid()}", "sale_price": "10", "vat_rate": "10", "unload_stock": False})
        ch = self.channel()["id"]
        cash = self.method("Contanti")
        for _ in range(3):
            self.admin.post("/sales", {"channel_id": ch, "sold_at": "2024-03-05T10:00:00", "lines": [{"product_id": prod["id"]}],
                                       "payments": [{"method_id": cash["id"], "amount": "10"}]})
        day = self.admin.get("/days/2024-03-05")
        exp = next(m for m in day["by_method"] if m["method_id"] == cash["id"])
        self.assertEqual(Dec(str(exp["received"])), Dec("30"))
        res = self.admin.post("/days/2024-03-05/close", {"counted": {str(cash["id"]): "28.50"}, "adjust_cash": True})
        self.assertEqual(Dec(str(res["difference"])), Dec("-1.50"))
        self.admin.post("/days/2024-03-05/close", {"counted": {}}, expect=409)
        c, _ = TestPermessi.make_user(self, "vendite")
        c.post("/sales", {"channel_id": ch, "sold_at": "2024-03-05T18:00:00", "lines": [{"product_id": prod["id"]}]}, expect=422)


class TestImportazione(Base):
    def xlsx(self, rows):
        wb = Workbook()
        ws = wb.active
        for r in rows:
            ws.append(r)
        b = io.BytesIO()
        wb.save(b)
        return b.getvalue()

    def test_verifica_e_duplicati(self):
        sku = "IMP-" + uid()
        data = self.xlsx([["codice", "nome", "unita", "giacenza", "costo_unitario", "tipo"],
                          [sku, "Pistacchio granella", "kg", "2,5", "18", "materia prima"],
                          [sku, "Doppione", "kg", "1", "1", "materia prima"],
                          ["IMP-X" + uid(), "Senza unità", "", "1", "1", ""],
                          ["IMP-Y" + uid(), "Nocciole", "kg", "abc", "1", "materia prima"]])
        f = {"file": ("articoli.xlsx", data, "application/octet-stream")}
        prev = self.admin.req("POST", "/import/items/preview", files=f)
        self.assertEqual(prev["summary"]["total"], 4)
        self.assertEqual(prev["summary"]["errors"], 3)
        self.admin.req("POST", "/import/items/commit", files=f, expect=422)  # niente importazioni parziali non richieste
        self.assertEqual(self.admin.get(f"/items?search={sku}"), [])
        res = self.admin.req("POST", "/import/items/commit", files=f, data={"skip_errors": "1"})
        self.assertEqual(res["imported"], 1)
        it = self.admin.get(f"/items?search={sku}")[0]
        self.assertEqual(Dec(str(it["qty_on_hand"])), Dec("2.5"))
        prev = self.admin.req("POST", "/import/items/preview", files=f)
        self.assertTrue(any(r["duplicate"] for r in prev["rows"]))

    def test_import_spese_csv(self):
        csv_data = ("data;descrizione;categoria;imponibile;importo_iva;totale;pagata\n"
                    f"03/01/2024;Bolletta luce {uid()};Utenze elettriche;100,00;22,00;122,00;si\n"
                    f"03/01/2024;Errore;Categoria inesistente;10;0;10;no\n").encode()
        f = {"file": ("spese.csv", csv_data, "text/csv")}
        prev = self.admin.req("POST", "/import/expenses/preview", files=f)
        self.assertEqual(prev["summary"]["errors"], 1)
        res = self.admin.req("POST", "/import/expenses/commit", files=f, data={"skip_errors": "1"})
        self.assertEqual(res["imported"], 1)
        prev = self.admin.req("POST", "/import/expenses/preview", files=f)
        self.assertEqual(prev["summary"]["duplicates"], 1)


class TestEsportazioni(Base):
    def test_report_pdf_excel(self):
        r = self.admin.get("/reports/pl.xlsx?from=2025-03-01&to=2025-03-31")
        self.assertEqual(r.content[:2], b"PK")
        r = self.admin.get("/reports/pl.pdf?from=2025-03-01&to=2025-03-31")
        self.assertEqual(r.content[:4], b"%PDF")
        r = self.admin.get("/export/items.csv")
        self.assertIn("Codice;Nome", r.content.decode("utf-8-sig").splitlines()[0])
        r = self.admin.get("/export-all.xlsx")
        self.assertEqual(r.content[:2], b"PK")
        cmp = self.admin.get("/reports/compare?kind=mese&a_year=2025&a_n=3&b_year=2025&b_n=4")
        self.assertEqual(len(cmp["rows"]), len(self.pl("2025-03-01", "2025-03-31")["lines"]))
        an = self.admin.get("/reports/analysis?from=2025-01-01&to=2025-12-31")
        self.assertIn("break_even", an)
        self.assertTrue(an["break_even"]["assumptions"])


class TestProdottiProntiEAmmanchi(Base):
    def test_collegamento_produzione_vendita_ammanchi(self):
        farina = self.item("Farina")
        self.load(farina["id"], 10, "2.00")
        box = self.item("Box", unit="pz", kind="confezione")
        self.load(box["id"], 100, "0.10")
        prod = self.admin.post("/products", {"name": f"Roll Nutella {uid()}", "sale_price": "5.50", "vat_rate": "10"})
        self.assertTrue(prod["stock_item_id"])                       # collegato in automatico alla creazione
        sid = prod["stock_item_id"]
        # la ricetta inserita dall'editor del prodotto va al pezzo pronto; il prodotto scarica 1 pezzo + box
        self.admin.post(f"/products/{prod['id']}/recipe", {"lines": [
            {"item_id": farina["id"], "qty": "100", "unit_code": "g"},
            {"item_id": box["id"], "qty": "1", "unit_code": "pz"}], "valid_from": "2025-01-01T00:00:00"})
        p = self.admin.get(f"/products/{prod['id']}")
        self.assertEqual({l["item_id"] for l in p["card"]["recipe"]["lines"]}, {sid, box["id"]})
        self.assertEqual(Dec(str(p["card"]["unit_cost"])), Dec("0.30"))  # 0,1 kg × 2 € + box 0,10 (costo teorico)
        self.assertEqual({l["item_id"] for l in p["edit_recipe"]["lines"]}, {farina["id"], box["id"]})
        # produzione del giorno: 20 pezzi → scarica 2 kg di farina
        out = self.admin.post("/productions/batch", {"lines": [{"item_id": sid, "qty": "20"}], "at": "2025-07-10T08:00:00"})
        self.assertEqual(out[0]["mode"], "produzione")
        self.assertEqual(self.qty(farina["id"]), Dec("8"))
        self.assertEqual(self.qty(sid), Dec("20"))
        # 15 vendite → restano 5 pezzi; ne vengono contati 3 → ammanco di 2
        s = self.admin.post("/sales", {"channel_id": self.channel()["id"], "sold_at": "2025-07-10T12:00:00",
                                       "lines": [{"product_id": prod["id"], "qty": "15"}]})
        self.assertEqual(self.qty(sid), Dec("5"))
        self.assertEqual(self.qty(box["id"]), Dec("85"))
        self.assertEqual(self.qty(farina["id"]), Dec("8"))          # gli ingredienti si scaricano alla produzione
        cnt = self.admin.post("/counts", {"item_ids": [sid]})
        self.admin.put(f"/counts/{cnt['id']}", {"lines": [{"item_id": sid, "counted_qty": "3"}]})
        self.admin.post(f"/counts/{cnt['id']}/confirm")
        rep = self.admin.get(f"/reports/shrinkage?from=2025-07-01&to={dt.date.today().isoformat()}")
        r = next(x for x in rep["items"] if x["id"] == sid)
        self.assertEqual(Dec(str(r["produced"])), Dec("20"))
        self.assertEqual(Dec(str(r["sold"])), Dec("15"))
        self.assertEqual(Dec(str(r["missing_qty"])), Dec("2"))
        self.assertEqual(Dec(str(r["missing_value"])), Dec("0.40"))
        self.assertTrue(rep["days"])
        # il P&L conta le materie al consumo: 15 pezzi × 0,20 + 15 box × 0,10
        pl = self.pl("2025-07-10", "2025-07-10")
        self.assertEqual(self.line(pl, "materie_prime"), Dec("4.50"))
        self.assertTrue(all(c["ok"] or c.get("warning") for c in pl["checks"]), pl["checks"])
        self.admin.post(f"/sales/{s['id']}/void", {"reason": "prova"})
        self.assertEqual(self.qty(sid), Dec("18"))

    def test_collega_tutti_e_bevande(self):
        lattina = self.item("Coca Cola lattina", unit="pz", kind="rivendita")
        self.load(lattina["id"], 24, "0.50")
        bib = self.admin.post("/products", {"name": f"Coca Cola {uid()}", "sale_price": "2.50", "vat_rate": "10",
                                            "track_stock": False})
        self.admin.post(f"/products/{bib['id']}/recipe", {"lines": [{"item_id": lattina["id"], "qty": "1", "unit_code": "pz"}]})
        acqua = self.admin.post("/products", {"name": f"Acqua {uid()}", "sale_price": "1", "vat_rate": "10", "track_stock": False})
        res = self.admin.post("/products/track-stock-all")
        self.assertGreaterEqual(res["linked"], 2)
        self.assertEqual(self.admin.get(f"/products/{bib['id']}")["stock_item_id"], lattina["id"])  # riusa la lattina esistente
        aq = self.admin.get(f"/products/{acqua['id']}")
        self.assertEqual(self.admin.get(f"/items/{aq['stock_item_id']}")["kind"], "rivendita")
        # rinominando il prodotto cambia anche l'articolo creato in automatico
        self.admin.put(f"/products/{acqua['id']}", {**{k: aq[k] for k in ("name", "sale_price", "vat_rate")}, "name": "Acqua naturale X"})
        self.assertEqual(self.admin.get(f"/items/{aq['stock_item_id']}")["name"], "Acqua naturale X")
        fg = self.admin.get("/finished-goods")
        self.assertTrue(any(r["id"] == lattina["id"] for r in fg))
        self.admin.post("/productions/batch", {"lines": [{"item_id": aq["stock_item_id"], "qty": "0"}]}, expect=422)

    def test_omaggi_assaggi_dal_dipendente(self):
        prod = self.admin.post("/products", {"name": f"Ciambella {uid()}", "sale_price": "2.00", "vat_rate": "10"})
        sid = prod["stock_item_id"]
        self.admin.post("/productions/batch", {"lines": [{"item_id": sid, "qty": "10"}]})
        emp, _ = self.make_user("vendite")
        g = emp.post("/giveaways", {"lines": [{"product_id": prod["id"], "qty": "3"}], "notes": "assaggi ai passanti"})
        self.assertEqual(self.qty(sid), Dec("7"))
        emp.get("/giveaways", expect=403)                       # il dipendente non vede lo storico
        lst = self.admin.get("/giveaways")
        self.assertEqual(lst[0]["id"], g["id"])
        today = dt.date.today().isoformat()
        r = next(x for x in self.admin.get(f"/reports/shrinkage?from={today}&to={today}")["items"] if x["id"] == sid)
        self.assertEqual(Dec(str(r["given"])), Dec("3"))
        self.assertEqual(Dec(str(r["wasted"])), Dec("0"))
        self.admin.post(f"/giveaways/{g['id']}/void", {"reason": "prova"})
        self.assertEqual(self.qty(sid), Dec("10"))

    def test_dipendente_chiusura_cassa_alla_cieca(self):
        emp, user_id = self.make_user("vendite")
        u = next(x for x in self.admin.get("/users") if x["id"] == user_id)
        self.admin.put(f"/users/{user_id}", {"email": u["email"], "full_name": u["full_name"], "role_id": u["role_id"],
                                             "overrides": [{"permission": "sales.close_day", "granted": True}]})
        d = "2025-08-14"
        day = emp.get(f"/days/{d}")
        self.assertTrue(day["blind"])
        self.assertNotIn("received", day["by_method"][0])             # non vede quanto dovrebbe esserci
        cash = next(m for m in day["by_method"] if m["kind"] == "contanti")
        res = emp.post(f"/days/{d}/close", {"counted": {str(cash["method_id"]): "50"}})
        self.assertNotIn("difference", res)
        full = self.admin.get(f"/days/{d}")
        self.assertEqual(Dec(str(full["closure"]["difference"])), Dec("50.00"))
        emp.get("/sales", expect=403)

    def test_collega_riusa_articolo_con_lo_stesso_nome(self):
        nome = f"Roll Nutella {uid()}"
        it = self.admin.post("/items", {"sku": f"R-{uid()}", "name": nome, "unit_code": "conf", "kind": "semilavorato",
                                        "semi_mode": "esplodi", "initial_qty": "100", "initial_cost": "0.80"})
        prod = self.admin.post("/products", {"name": nome, "sale_price": "5", "vat_rate": "10", "track_stock": False})
        self.admin.post(f"/products/{prod['id']}/track-stock")
        p = self.admin.get(f"/products/{prod['id']}")
        self.assertEqual(p["stock_item_id"], it["id"])                  # nessun doppione
        self.admin.post("/sales", {"channel_id": self.channel()["id"], "lines": [{"product_id": prod["id"], "qty": "2"}]})
        self.assertEqual(self.qty(it["id"]), Dec("98"))
