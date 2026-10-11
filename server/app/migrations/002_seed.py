"""Dati di base: unità, ruoli, categorie, canali, metodi di pagamento, conti, impostazioni.

Questi NON sono dati di prova: sono le tabelle di configurazione iniziali, modificabili dall'app.
"""
import json

from app.permissions import ROLES

UNITS = [
    ("kg", "Chilogrammi", "massa", 1000), ("g", "Grammi", "massa", 1),
    ("l", "Litri", "volume", 1000), ("ml", "Millilitri", "volume", 1),
    ("pz", "Pezzi", "pezzi", 1), ("conf", "Confezioni", "conf", 1),
]

EXPENSE_CATEGORIES = [
    # nome, gruppo conto economico, entra in magazzino
    ("Affitto", "costi_fissi", False),
    ("Stipendi e collaboratori", "personale", False),
    ("Contributi e oneri del personale", "personale", False),
    ("Acquisto di materie prime", "materie_prime", True),
    ("Packaging e confezioni", "materie_prime", True),
    ("Utenze elettriche", "costi_fissi", False),
    ("Acqua e gas", "costi_fissi", False),
    ("Internet e telefonia", "costi_fissi", False),
    ("Commissioni delle piattaforme", "costi_variabili", False),
    ("Commissioni POS e bancarie", "costi_variabili", False),
    ("Commercialista", "costi_fissi", False),
    ("Marketing e pubblicità", "altri_operativi", False),
    ("Attrezzature", "investimenti", False),
    ("Manutenzione", "altri_operativi", False),
    ("Trasporti e carburante", "altri_operativi", False),
    ("Assicurazioni", "costi_fissi", False),
    ("Imposte e tributi", "imposte", False),
    ("Interessi e oneri finanziari", "oneri_finanziari", False),
    ("Altre spese", "altri_operativi", False),
]

SETTINGS = {
    "company": {"name": "Isaa Rolls", "legal_name": "", "vat_number": "", "address": ""},
    "vat_regime": "ordinario",                 # ordinario | forfettario
    "default_sale_vat_rate": 10,
    "prices_include_vat": True,
    "default_target_margin_pct": 70,           # margine lordo obiettivo sul prezzo netto
    "allow_negative_stock": True,
    "materials_cost_method": "consumi",        # consumi | acquisti
    "inventory_valuation": "costo_medio_ponderato",
    "expiry_warning_days": 3,
    "due_warning_days": 7,
    "investments_treatment": "spesa_immediata",  # spesa_immediata | ammortamento (vedi categorie)
    "lock_closed_days": True,
    "platform_commissions_from": "vendite",    # vendite (stima da % canale) | spese (fatture registrate)
}


def run(c):
    for code, name, dim, factor in UNITS:
        c.exec("INSERT INTO units(code,name,dimension,factor) VALUES (%s,%s,%s,%s)", [code, name, dim, factor])

    for code, r in ROLES.items():
        rid = c.val(
            "INSERT INTO roles(code,name,description,is_system) VALUES (%s,%s,%s,true) RETURNING id",
            [code, r["name"], r["description"]],
        )
        for p in r["permissions"]:
            c.exec("INSERT INTO role_permissions(role_id,permission) VALUES (%s,%s)", [rid, p])

    for i, (name, group, inv) in enumerate(EXPENSE_CATEGORIES):
        c.exec(
            "INSERT INTO expense_categories(name,pl_group,is_inventory,is_platform_commission,sort_order) "
            "VALUES (%s,%s,%s,%s,%s)",
            [name, group, inv, name == "Commissioni delle piattaforme", i],
        )

    cassa = c.val("INSERT INTO accounts(name,kind) VALUES ('Cassa contanti','cassa') RETURNING id")
    banca = c.val("INSERT INTO accounts(name,kind) VALUES ('Conto corrente','banca') RETURNING id")

    methods = [
        ("Contanti", "contanti", cassa, True),
        ("Carta / POS", "carta", banca, True),
        ("Satispay / pagamenti elettronici", "elettronico", banca, True),
        ("Pagato su piattaforma (da accreditare)", "piattaforma", banca, False),
    ]
    mids = {}
    for i, (name, kind, acc, imm) in enumerate(methods):
        mids[kind] = c.val(
            "INSERT INTO payment_methods(name,kind,account_id,received_immediately,sort_order) "
            "VALUES (%s,%s,%s,%s,%s) RETURNING id",
            [name, kind, acc, imm, i],
        )

    channels = [
        ("Vendita diretta", 0, 0, mids["contanti"]),
        ("Glovo", 0, 0, mids["piattaforma"]),
        ("Deliveroo", 0, 0, mids["piattaforma"]),
        ("Just Eat", 0, 0, mids["piattaforma"]),
        ("Eventi e catering", 0, 0, None),
    ]
    for i, (name, pct, fixed, pm) in enumerate(channels):
        c.exec(
            "INSERT INTO sales_channels(name,commission_pct,commission_fixed,default_payment_method_id,sort_order) "
            "VALUES (%s,%s,%s,%s,%s)",
            [name, pct, fixed, pm, i],
        )

    for name in ["Farine e impasti", "Creme e farciture", "Decorazioni e granelle", "Zuccheri",
                 "Latticini e uova", "Confezioni", "Bevande", "Materiali di consumo"]:
        c.exec("INSERT INTO item_categories(name) VALUES (%s)", [name])
    for i, name in enumerate(["Rolls", "Ciambelle", "Bevande", "Altro"]):
        c.exec("INSERT INTO product_categories(name,sort_order) VALUES (%s,%s)", [name, i])

    for k, v in SETTINGS.items():
        c.exec("INSERT INTO settings(key,value) VALUES (%s,%s::jsonb)", [k, json.dumps(v)])
