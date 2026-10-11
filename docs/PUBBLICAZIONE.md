# Pubblicazione online di Isaa Rolls Manager

Questa guida porta il gestionale su un indirizzo web tuo, ad esempio `https://gestionale.isaarolls.it`, con HTTPS e backup automatici.
Tutto il necessario è già pronto nel progetto: `Dockerfile`, `render.yaml`, migrazioni del database e workflow di backup.
**I passaggi segnati con 👤 richiedono il tuo intervento**, perché servono account, pagamenti o accesso al dominio che io non posso usare.

Tempo stimato: circa 45 minuti la prima volta.
Costo: circa **7 $ al mese** (servizio web Render sempre acceso). Il database PostgreSQL è sul **piano gratuito di Neon**: 1 GB, permanente, senza carta di credito.
Verifica i prezzi aggiornati su render.com/pricing e neon.com/pricing.

---

## 1. 👤 Metti il codice su GitHub
1. Crea un account su <https://github.com>, se non lo hai.
2. Crea un repository **privato** chiamato `isa-manager`: «New repository» → Private → Create.
3. Carica il contenuto della cartella `isa-manager`. Hai due modi:
   - dal sito, con «uploading an existing file» (trascina tutte le cartelle);
   - oppure con GitHub Desktop: «Add local repository» → «Publish».

Non caricare file `.env` o password: il file `.gitignore` li esclude già.

## 2a. 👤 Crea il database gratuito su Neon
1. Crea un account su <https://neon.com> (va bene «Sign up with GitHub»).
2. Crea un progetto con questi dati:
   - nome: `isa-manager`;
   - versione: Postgres 17;
   - regione: **AWS Europe Central (Frankfurt)**.
3. Nella pagina del progetto premi **Connect** e copia la *connection string*. Inizia con `postgresql://` e finisce con `?sslmode=require`. Ti servirà al passo successivo.

## 2b. 👤 Crea il servizio su Render
1. Crea un account su <https://render.com> e collega GitHub.
2. Vai su **New → Blueprint**, scegli il repository e conferma. Render legge `render.yaml` e crea il servizio web `isa-manager`, che compila l'interfaccia e avvia il server.
3. Quando lo chiede, compila le variabili:
   - `DATABASE_URL`: incolla la connection string di Neon.
   - `PUBLIC_URL`: l'indirizzo finale, ad esempio `https://gestionale.isaarolls.it`. All'inizio va bene `https://isa-manager.onrender.com`.
   - `SMTP_*`: facoltativi, per le e-mail di recupero password (vedi punto 6). Puoi lasciarli vuoti.
4. Aspetta che il deploy sia «Live», circa 5–8 minuti. Le tabelle del database vengono create automaticamente al primo avvio.
5. Verifica che `https://isa-manager.onrender.com/healthz` risponda `{"status":"ok","env":"production"}`.

## 3. 👤 Crea il primo amministratore (te)
1. Su Render apri il servizio `isa-manager` → **Shell**.
2. Esegui (con la tua e-mail):
   ```
   python -m app.cli create-admin --email tuamail@esempio.it --name "Nome Cognome"
   ```
3. Il comando stampa una **password temporanea**. Accedi al sito con quella: al primo accesso ti verrà chiesto di sceglierne una nuova.

Il database di produzione parte **vuoto**: nessun dato di prova. I dati dimostrativi esistono solo nell'ambiente di sviluppo e lo script che li crea si rifiuta di funzionare in produzione.

## 4. 👤 Collega il tuo dominio (HTTPS automatico)
1. Su Render: servizio `isa-manager` → **Settings → Custom Domains → Add** → scrivi `gestionale.isaarolls.it`.
2. Nel pannello del tuo registrar (Aruba, Register.it, GoDaddy…) aggiungi il record DNS che Render ti indica: un **CNAME** `gestionale` → `isa-manager.onrender.com`.
3. Entro qualche minuto (a volte qualche ora) Render emette il certificato HTTPS. L'app accetta solo HTTPS: le richieste HTTP vengono reindirizzate.
4. Aggiorna `PUBLIC_URL` con il nuovo indirizzo: Environment → Save. Il servizio si riavvia da solo.

## 5. Backup e ripristino
I backup sono su tre livelli:

| Livello | Cosa fa | Dove |
|---|---|---|
| Neon (gratuito) | Ripristino a un qualsiasi istante delle ultime 6 ore | Neon → progetto → *Restore* |
| **Backup notturno su GitHub** (fondamentale) | `pg_dump` completo ogni notte, conservato 90 giorni | GitHub → *Actions* → *Backup database* |
| Esportazione dall'app | Excel con tutti i dati, quando vuoi | Impostazioni → Esporta e backup |

👤 Per attivare il backup su GitHub:
1. Copia la connection string di Neon, la stessa usata per `DATABASE_URL`.
2. Su GitHub apri il repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - nome: `PROD_DATABASE_URL`
   - valore: l'URL copiato.
3. Vai in **Actions → Backup database → Run workflow** per provarlo subito. Il file del backup è negli «Artifacts» dell'esecuzione.

Gli **allegati** (fatture PDF, foto) sono salvati nel database, quindi sono inclusi in tutti i backup.

### Ripristino
- **Errore delle ultime ore** (cancellazioni, importazioni sbagliate): Neon → progetto → *Restore*. Scegli l'istante precedente all'errore.
- **Da un backup di GitHub** (da un computer con PostgreSQL client installato):
  ```
  DATABASE_URL="<connection string Neon>" ./server/scripts/restore.sh isa-manager-AAAA-MM-GG.dump
  ```
  Lo script chiede di scrivere `RIPRISTINA` per confermare.
- **Prova di ripristino consigliata**: una volta ogni 3 mesi ripristina un backup su un database di prova e controlla i report.

In più, dall'app (Impostazioni → Esporta e backup) puoi scaricare in qualsiasi momento un **Excel con tutti i dati**.

## 6. E-mail per il recupero password (facoltativo)
Senza e-mail l'amministratore genera da **Utenti → Link nuova password** un link valido 2 ore, da inviare al collaboratore.
Per l'invio automatico serve un servizio SMTP, ad esempio Brevo (gratuito fino a 300 e-mail al giorno) oppure Gmail con «password per le app». Imposta su Render:

```
SMTP_HOST=smtp-relay.brevo.com   SMTP_PORT=587
SMTP_USER=...   SMTP_PASSWORD=...   SMTP_FROM=gestionale@isaarolls.it
```

## 7. Ambiente di test separato (consigliato prima di grandi modifiche)
- **Sul tuo computer**: segui `INSTALLAZIONE.md`. Usa un database di sviluppo separato e i dati di prova.
- **Online**: puoi creare un secondo Blueprint dallo stesso repository (ad esempio `isa-manager-test`), con `APP_ENV=staging` e un database proprio. Nell'interfaccia comparirà la banda «Ambiente di prova».
- **Test automatici**: a ogni modifica caricata su GitHub, il workflow *Test automatici* li esegue su un database temporaneo.

## 8. Aggiornamenti
Ogni modifica caricata sul ramo principale del repository viene pubblicata automaticamente (`autoDeploy`). Le migrazioni del database vengono applicate all'avvio, in modo sicuro: un blocco impedisce che due esecuzioni partano insieme. Prima di un aggiornamento importante conviene avviare a mano il backup su GitHub.

## 9. Riepilogo dei segreti (nessuno è nel codice)
| Variabile | Dove si imposta |
|---|---|
| `DATABASE_URL` | Render → servizio → Environment (connection string di Neon) |
| `PUBLIC_URL`, `SMTP_*` | Render → servizio → Environment |
| `PROD_DATABASE_URL` | GitHub → Settings → Secrets (solo per il backup) |

## 10. Quando servirà più spazio
Il piano gratuito di Neon ha 1 GB: basta per anni di vendite e spese, ma le foto delle fatture lo riempiono più in fretta. Neon avvisa quando ci si avvicina al limite. A quel punto hai due strade:
- passare al piano a consumo di Neon, senza canone fisso;
- creare un database su Render (circa 6 $ al mese), ripristinarci l'ultimo backup con `restore.sh` e cambiare `DATABASE_URL`.
