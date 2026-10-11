# Installazione per sviluppo e test (sul tuo computer)

Requisiti: **Python 3.12+**, **Node.js 20+**, **PostgreSQL 15+**.

```bash
# 1. database di sviluppo e di test (separati da quello di produzione)
createuser -P isa                      # scegli una password
createdb -O isa isa_dev
createdb -O isa isa_test

# 2. backend
cd server
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # poi metti la password in DATABASE_URL
export $(grep -v '^#' .env | xargs)                    # Windows: imposta le variabili a mano
python -m app.migrate                                  # crea le tabelle
python -m app.cli create-admin --email tu@esempio.it --name "Nome Cognome"
python scripts/seed_demo.py                            # FACOLTATIVO: dati di prova (mai in produzione)

# 3. interfaccia
cd ../web
npm install
node build.mjs                                         # oppure: node build.mjs --watch

# 4. avvio
cd ../server
uvicorn app.main:app --reload --port 8000
```
Apri <http://localhost:8000>. La documentazione delle API è su <http://localhost:8000/api/docs>.

## Test automatici
```bash
cd server
TEST_DATABASE_URL=postgresql://isa:PASSWORD@127.0.0.1:5432/isa_test python -m tests.run
```
I test **cancellano e ricreano** il database di test. Per sicurezza rifiutano di girare su un database il cui nome non contiene «test».

I test coprono:
- formule (IVA, sconti, ripartizioni, date, ricorrenze);
- autenticazione, CSRF, ruoli e permessi;
- magazzino: costo medio, conversione unità, storni, immutabilità, inventari, lotti FEFO, 40 vendite simultanee;
- ricette e versioni;
- vendite, annullamenti, sconti, pagamenti misti, rimborsi, crediti e accrediti;
- acquisti senza doppio conteggio, ordini parziali, pagamenti, costi ripartiti, IVA indetraibile, ammortamento, ricorrenze senza falsi pagamenti, allegati;
- chiusura di mesi e giornate;
- importazioni con errori e duplicati;
- esportazioni PDF ed Excel;
- coerenza tra il dettaglio delle voci e i totali dei report.

## Controllo di coerenza dei dati
```bash
python -m app.cli check     # giacenze = movimenti, pagamenti, totali vendite
```

## Struttura del progetto
```
server/app/          API (api/), logica (services/), migrazioni (migrations/), sicurezza
server/tests/        test automatici
server/scripts/      dati di prova, backup.sh, restore.sh
web/src/             interfaccia React (pages/ = schermate)
web/public/          logo, icone, manifest, privacy
docs/                progettazione, pubblicazione, app store, guida utente
Dockerfile, render.yaml, .github/workflows/   pubblicazione, test e backup automatici
```

### Nota sul driver del database
In produzione si usa **psycopg 3**. Se non è installato, ad esempio in ambienti senza accesso a PyPI, l'app usa automaticamente un driver di riserva basato su `libpq` (`app/pq.py`), con la stessa interfaccia.
