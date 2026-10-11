# Isa Manager – gestionale Isaa Rolls

Gestionale web e mobile per:
- magazzino, ricette e food cost;
- vendite, incassi e chiusura di cassa;
- spese, fornitori e ordini;
- conto economico gestionale, liquidità e analisi.

È multiutente, con ruoli e permessi controllati sul server e un registro di tutte le operazioni.

| Documento | Per cosa |
|---|---|
| [docs/GUIDA_UTENTE.md](docs/GUIDA_UTENTE.md) | Come si usa ogni giorno |
| [docs/PUBBLICAZIONE.md](docs/PUBBLICAZIONE.md) | Metterlo online con dominio, HTTPS e backup (passaggi da fare tu) |
| [docs/APP_STORE.md](docs/APP_STORE.md) | App per iPhone e Android |
| [docs/PROGETTAZIONE.md](docs/PROGETTAZIONE.md) | Architettura, database, ruoli, formule economiche |
| [docs/INSTALLAZIONE.md](docs/INSTALLAZIONE.md) | Sviluppo locale e test automatici |

**Stack**:
- interfaccia React su web e Capacitor su mobile;
- API Python (Starlette) documentata su `/api/docs`;
- database PostgreSQL con migrazioni;
- pubblicazione con Docker su Render.

I risultati economici sono una stima gestionale, non un bilancio fiscale: i criteri di calcolo sono configurabili e vanno concordati con il commercialista.
