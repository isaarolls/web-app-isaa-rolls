"""Catalogo dei permessi e ruoli predefiniti.

Ogni permesso è controllato lato server su ogni richiesta (vedi app/http.py).
"""

PERMISSIONS: dict[str, tuple[str, str]] = {
    # codice: (modulo, descrizione)
    "dashboard.view": ("Dashboard", "Vedere la dashboard operativa"),
    "dashboard.finance": ("Dashboard", "Vedere incassi, costi e margini in dashboard"),
    "inventory.view": ("Magazzino", "Vedere articoli e giacenze"),
    "inventory.costs": ("Magazzino", "Vedere costi e valore delle scorte"),
    "inventory.edit": ("Magazzino", "Creare e modificare articoli"),
    "inventory.move": ("Magazzino", "Registrare carichi, scarichi e sprechi"),
    "inventory.count": ("Magazzino", "Eseguire inventari fisici"),
    "inventory.reverse": ("Magazzino", "Stornare movimenti di magazzino"),
    "products.view": ("Prodotti e ricette", "Vedere prodotti e ricette"),
    "products.costs": ("Prodotti e ricette", "Vedere costi e margini dei prodotti"),
    "products.edit": ("Prodotti e ricette", "Modificare prodotti, prezzi e ricette"),
    "production.create": ("Prodotti e ricette", "Registrare produzioni di semilavorati"),
    "sales.view": ("Vendite", "Vedere le vendite"),
    "sales.create": ("Vendite", "Registrare vendite"),
    "sales.void": ("Vendite", "Annullare vendite"),
    "sales.refund": ("Vendite", "Registrare rimborsi e storni"),
    "sales.close_day": ("Vendite", "Eseguire la chiusura di cassa giornaliera"),
    "payments.view": ("Incassi", "Vedere incassi, crediti e saldi dei conti"),
    "payments.manage": ("Incassi", "Registrare accrediti, movimenti di cassa e conti"),
    "expenses.view": ("Spese", "Vedere le spese"),
    "expenses.edit": ("Spese", "Registrare e modificare spese"),
    "expenses.pay": ("Spese", "Registrare pagamenti delle spese"),
    "expenses.void": ("Spese", "Annullare spese e pagamenti"),
    "suppliers.view": ("Fornitori", "Vedere i fornitori"),
    "suppliers.edit": ("Fornitori", "Creare e modificare fornitori"),
    "purchasing.view": ("Ordini", "Vedere ordini di acquisto e ricevimenti"),
    "purchasing.edit": ("Ordini", "Creare e modificare ordini di acquisto"),
    "purchasing.receive": ("Ordini", "Registrare il ricevimento della merce"),
    "reports.view": ("Report", "Vedere report economici e analisi"),
    "reports.export": ("Report", "Scaricare report in PDF ed Excel"),
    "periods.close": ("Report", "Chiudere e riaprire i mesi"),
    "import.run": ("Impostazioni", "Importare dati da CSV/Excel"),
    "export.run": ("Impostazioni", "Esportare tutti i dati aziendali"),
    "users.manage": ("Utenti e permessi", "Gestire utenti, ruoli e permessi"),
    "settings.manage": ("Impostazioni", "Modificare impostazioni e tabelle di base"),
    "audit.view": ("Utenti e permessi", "Consultare il registro attività"),
}

ALL = list(PERMISSIONS)

ROLES = {
    "admin": {
        "name": "Titolare / Amministratore",
        "description": "Accesso completo a tutti i moduli",
        "permissions": ALL,
    },
    "responsabile": {
        "name": "Responsabile",
        "description": "Accesso completo a tutte le funzioni (a 360 gradi)",
        "permissions": ALL,
    },
    "magazzino": {
        "name": "Addetto al magazzino",
        "description": "Carichi, scarichi, inventari; nessun dato finanziario",
        "permissions": [
            "dashboard.view", "inventory.view", "inventory.edit", "inventory.move", "inventory.count",
            "products.view", "production.create", "suppliers.view", "purchasing.view", "purchasing.receive",
        ],
    },
    "vendite": {
        "name": "Dipendente (solo vendite)",
        "description": "Può soltanto registrare le vendite: non vede magazzino, incassi, costi né report",
        "permissions": ["sales.create"],
    },
}
