# Isaa Rolls Manager – Documento di progettazione

Gestionale web per **Isaa Rolls**: magazzino, ricette, vendite, incassi, spese, fornitori, ordini, report economici.
Usabile da browser (computer, tablet, telefono) e come app per iPhone e Android.

## 1. Architettura

```
 Telefono / tablet / PC                        Server (Render, Francoforte)
┌──────────────────────────┐   HTTPS + JSON   ┌───────────────────────────────┐     ┌──────────────────┐
│ Interfaccia React         │ ───────────────▶ │ API Python (Starlette/Uvicorn)│ ──▶ │ PostgreSQL 17    │
│ (browser o app Capacitor) │ ◀─────────────── │ permessi controllati qui      │     │ dati + allegati  │
└──────────────────────────┘                   └───────────────────────────────┘     └──────────────────┘
                                                        │ backup notturno (GitHub Actions, 90 giorni)
                                                        ▼ + PITR ed esportazioni giornaliere di Render
```

| Livello | Tecnologia | Note |
|---|---|---|
| Interfaccia | React 19, CSS proprio, grafici SVG | Un solo codice per web, iPhone e Android. Italiano, euro, date gg/mm/aaaa, virgola decimale. |
| App mobile | Capacitor 7 | Impacchetta l'interfaccia; parla con lo stesso server. |
| API | Python 3.12, Starlette, Pydantic | API JSON documentate su `/api/docs` e `/api/openapi.json`. |
| Database | PostgreSQL | Transazioni, vincoli, trigger di sicurezza, migrazioni versionate (`server/app/migrations`). |
| Report | openpyxl (Excel), ReportLab (PDF) | Generati dal server con gli stessi calcoli mostrati a video. |

### Sicurezza
- **Account personali** con password cifrate (scrypt). Al primo accesso la password temporanea va cambiata.
- **Sessioni** con token casuale (nel database ne è salvata solo l'impronta). Il browser usa un cookie `HttpOnly`/`Secure`/`SameSite`, l'app usa un token `Bearer`. Scadono dopo 14 giorni o 72 ore di inattività. Disattivare un utente lo disconnette subito da tutti i dispositivi.
- **Permessi verificati sul server a ogni richiesta**, non solo nascondendo i menu.
- Protezioni attive:
  - CSRF tramite header obbligatorio;
  - limite di 10 tentativi di accesso falliti ogni 15 minuti;
  - intestazioni di sicurezza (CSP, HSTS, X-Frame-Options);
  - HTTPS obbligatorio in produzione.
- **Allegati** (PDF e immagini, massimo 10 MB): il tipo del file viene controllato e il download richiede i permessi del documento a cui appartengono. Sono salvati nel database, quindi finiscono nei backup.
- **Dati non modificabili**:
  - i movimenti di magazzino e il registro attività non si possono modificare né cancellare, nemmeno via SQL (trigger);
  - le correzioni si fanno con storni;
  - i mesi chiusi sono bloccati a livello di database.
- **GDPR**: esportazione dei dati personali di un utente e anonimizzazione.
- **Nessun segreto nel codice**: tutte le credenziali arrivano dalle variabili d'ambiente.

## 2. Ruoli

| Ruolo | Cosa può fare |
|---|---|
| Titolare / Amministratore | Tutto: utenti, permessi, impostazioni, chiusura mesi, esportazione completa. |
| Responsabile | Tutto, come il titolare (accesso a 360°). |
| Dipendente (solo vendite) | Solo registrare vendite dalla cassa. Non vede magazzino, incassi, costi, report né lo storico. Può registrare vendite al massimo del giorno prima. |
| Addetto al magazzino *(facoltativo)* | Carichi, scarichi, inventari, ricevimento merce. Nessun dato economico. |

I permessi (36, per modulo e tipo di operazione) si possono cambiare per ruolo o aggiungere e togliere al singolo utente.

## 3. Database (tabelle principali)

| Area | Tabelle |
|---|---|
| Accesso | `users`, `roles`, `role_permissions`, `user_permissions`, `sessions`, `password_resets`, `login_attempts`, `audit_log` |
| Magazzino | `items` (articoli), `stock_movements` (immutabili), `stock_lots` (lotti e scadenze), `inventory_counts`, `inventory_count_lines`, `units` |
| Ricette | `products`, `recipe_versions`, `recipe_lines`, `productions` |
| Vendite | `sales`, `sale_lines`, `sale_payments`, `settlements` (accrediti delle piattaforme), `day_closures`, `sales_channels`, `payment_methods` |
| Costi | `expenses`, `expense_payments`, `recurring_expenses`, `expense_categories`, `economic_entries`, `attachments` |
| Acquisti | `suppliers`, `supplier_items`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines` |
| Liquidità | `accounts` (cassa, banca), `cash_movements` |
| Periodi | `period_closures`, `settings` |

### Regole di coerenza
- **Giacenza e costo medio** si aggiornano solo insieme al movimento, nella stessa transazione e con il blocco della riga dell'articolo. Due vendite simultanee non possono quindi corrompere la giacenza: il test esegue 40 vendite in parallelo.
- **Vendita**: righe, IVA, pagamenti e scarico degli ingredienti vengono salvati in un'unica transazione. O si salva tutto o niente.
- **Annullamenti**: la vendita resta nello storico come annullata. Il magazzino viene ripristinato con storni datati come i movimenti originali.
- **Ricette con versioni**: ogni modifica crea una nuova versione. Ogni riga di vendita memorizza la versione e il costo teorico del momento, quindi i mesi passati non cambiano.

## 4. Formule economiche

Tutti gli importi sono calcolati in decimale esatto con arrotondamento al centesimo. Le somme di imponibile e IVA tornano sempre al totale.

| Grandezza | Formula |
|---|---|
| Imponibile di una vendita | prezzo IVA inclusa ÷ (1 + aliquota) (IVA = differenza) |
| Sconti | lo sconto sul totale è ripartito sulle righe in proporzione, al centesimo |
| Costo medio ponderato | (giacenza × costo medio + quantità caricata × costo) ÷ nuova giacenza |
| Costo di una riga di ricetta | quantità convertita nell'unità di magazzino ÷ (1 − calo%) × costo unitario |
| Costo diretto prodotto | (materie prime + confezioni) ÷ resa; i semilavorati «scomponi» sono calcolati dalla loro ricetta |
| Food cost % | costo diretto ÷ prezzo netto IVA |
| Margine lordo unitario | prezzo netto IVA − costo diretto |
| Prezzo consigliato | costo diretto ÷ (1 − margine obiettivo) × (1 + IVA) |
| Commissione piattaforma | lordo × % canale + quota fissa; la parte netta è un costo, l'IVA (22%) va a credito |

### Conto economico gestionale (per periodo)
1. **Ricavi netti** = imponibile delle vendite valide (sconti già dedotti) − imponibile dei rimborsi.
2. **IVA** sulle vendite: esposta a parte, non è un ricavo.
3. **Materie prime consumate** = valore a costo medio dei movimenti di consumo del periodo: vendite, produzioni, scarichi, sprechi e rettifiche d'inventario, con i relativi storni.
4. **Margine lordo** = 1 − 3.
5. **Costi variabili** = commissioni nette delle piattaforme + spese «costi variabili».
6. **Costi fissi**, 7. **Personale**, 8. **Altri costi operativi**: spese per data di competenza. Si usa l'imponibile se l'IVA è detraibile, il lordo se non lo è. Le categorie con ammortamento sono ripartite in N mesi. Se il periodo non copre mesi interi, fissi e personale sono ripartiti per giorni.
9. **Risultato operativo** = 4 − 5 − 6 − 7 − 8.
10. **Oneri finanziari**.
11. **Altre componenti**: altri ricavi, imposte registrate, voci manuali.
12. **Risultato del periodo** = 9 − 10 + 11.

**Niente doppi conteggi**: gli acquisti di merce di magazzino non sono un costo quando arriva la fattura, ma quando la merce si consuma. Allo stesso modo, le fatture delle commissioni delle piattaforme non si sommano alle commissioni già stimate sulle vendite. Gli importi esclusi sono mostrati sotto il conto economico. Entrambi i criteri sono modificabili in Impostazioni.

### Liquidità (separata dal risultato)
- **Entrate**: pagamenti ricevuti subito + accrediti delle piattaforme + apporti.
- **Uscite**: pagamenti delle spese + prelievi.
- **Crediti**: vendite pagate tramite piattaforma e non ancora accreditate.
- **Debiti**: spese non saldate.
- **Saldo dei conti**: saldo iniziale ± tutti i movimenti.

### Punto di pareggio
Costi di struttura medi mensili ÷ margine di contribuzione %. Il calcolo usa gli ultimi 3 mesi completi e le ipotesi sono mostrate a video.

### Controlli automatici (in ogni report)
- totale vendite = righe = pagamenti;
- imponibile + IVA = totale;
- giacenze = somma dei movimenti;
- valore delle scorte coerente con i movimenti;
- spese di magazzino collegate a un carico.

## 5. Schermate

| Schermata | Contenuto |
|---|---|
| Dashboard | Indicatori cliccabili, grafici giornalieri e su 12 mesi, scadenze, scorte basse, lotti in scadenza, IVA. |
| Vendi | Cassa a riquadri con pagamento misto e sconti; modalità «totale giornaliero». |
| Vendite | Elenco, dettaglio, annullamento, rimborso, chiusura di cassa. |
| Incassi | Crediti da incassare, accrediti delle piattaforme, saldi e movimenti di cassa e banca. |
| Magazzino | Articoli, movimenti, inventari fisici, produzioni, lotti. |
| Prodotti e ricette | Schede costo, editor della ricetta con anteprima del costo, versioni. |
| Spese | Spese, pagamenti, allegati, ricorrenze, voci economiche manuali. |
| Fornitori, Ordini | Ordini di acquisto, ricevimento merce con fattura collegata. |
| Report | Conto economico, liquidità, controlli, confronti, analisi, PDF ed Excel, chiusura mesi. |
| Utenti e permessi, Impostazioni | Gestione accessi; importazioni ed esportazioni. |
