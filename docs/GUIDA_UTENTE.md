# Guida pratica a Isaa Rolls Manager

## Primo avvio: in quest'ordine (circa 1 ora)
1. **Impostazioni → Azienda e criteri.** Controlla il nome dell'azienda, il regime IVA (ordinario), l'aliquota delle vendite (10%) e il margine obiettivo. Il criterio «costo materie prime sui consumi» è quello consigliato.
2. **Impostazioni → Tabelle di base.**
   - **Conti**: inserisci il saldo iniziale di cassa e del conto corrente alla data di partenza.
   - **Canali**: imposta la commissione di Glovo e delle altre piattaforme (%, quota fissa).
   - **Metodi di pagamento**: «Pagato su piattaforma» resta da incassare finché non arriva il bonifico.
3. **Magazzino.** Crea gli articoli: farina, latte, creme, granelle, box, tovaglioli…
   - Puoi farlo uno per uno con «Nuovo articolo», inserendo la giacenza iniziale e il costo.
   - Oppure in blocco da Impostazioni → Importa → *Articoli e giacenze iniziali*: scarica il modello Excel, compilalo e caricalo. Prima di salvare, il sistema mostra gli errori.
   - **L'impasto** conviene crearlo come *Semilavorato* con la sua ricetta, ad esempio «10 kg di impasto = 5,5 kg di farina + 2,5 l di latte…». Scegli «Scomponi negli ingredienti alla vendita» se non vuoi registrare le produzioni.
4. **Prodotti e ricette.** Crea i prodotti in vendita con il prezzo al pubblico, poi «Crea ricetta». Mentre scrivi le quantità vedi subito il costo, il food cost, il margine e il prezzo consigliato.
5. **Fornitori.** Inserisci ragione sociale, contatti e «giorni per il pagamento» (calcola le scadenze delle fatture).
6. **Spese ricorrenti** (Spese → Spese ricorrenti): affitto, stipendi, commercialista, telefono. Ogni mese viene creata in automatico la spesa *da pagare*.
7. **Utenti e permessi.** Crea un account per ogni collaboratore:
   - *Dipendente* per chi sta in cassa (vede solo la cassa);
   - *Responsabile* per chi gestisce tutto.

   Consegna di persona la password temporanea.

## Ogni giorno
- **Vendere**: tocca i prodotti, scegli il metodo di pagamento e premi «Registra vendita». Gli ingredienti si scaricano da soli dal magazzino.
  - Le vendite Glovo vanno registrate con il canale «Glovo» e il pagamento «Pagato su piattaforma».
  - Se in una giornata non hai registrato i singoli scontrini, usa «Totale giornaliero» e inserisci solo l'importo.
- **Errori**: da Vendite apri la vendita → «Annulla vendita», indicando il motivo. Il magazzino torna com'era e l'annullamento resta nello storico.
- **Chiusura di cassa** (Vendite → Chiusura di cassa): conta i contanti e controlla il totale del POS. Il sistema mostra le differenze; con l'opzione attiva allinea il saldo di cassa.

## Pezzi pronti e controllo ammanchi
Ogni prodotto in vendita (roll, ciambelle, bibite) è contato a magazzino come «pezzo pronto». I prodotti nuovi si collegano da soli; quelli già esistenti si collegano una volta con **Prodotti → «Collega tutti al magazzino»**.
- **La mattina** (Magazzino → Pezzi pronti e ammanchi): scrivi quanti pezzi hai preparato e premi «Registra produzione». Gli ingredienti escono dal magazzino secondo la ricetta.
- **Durante il giorno**: ogni vendita in cassa toglie un pezzo.
- **Assaggi regalati**: in cassa scegli «Omaggio / assaggio», tocca i prodotti regalati e premi «Registra omaggio». Il prezzo è 0 €, la giacenza scende e il costo resta registrato.
- **A fine giornata**: premi «Conta di fine giornata», scrivi i pezzi rimasti davvero e conferma.
- **Controllo ammanchi**: per ogni prodotto vedi preparati, venduti, omaggi, sprechi e **pezzi mancanti**, cioè quelli usciti senza essere battuti in cassa, con il loro valore e chi ha fatto la conta.
- Le bibite si caricano con «Ricevi merce» quando arrivano.

La ricetta di un prodotto collegato si modifica come sempre dalla sua pagina: gli ingredienti vanno al pezzo pronto, le confezioni restano sul prodotto.

## Ogni settimana
- **Arrivo merce**: Ordini → «Ricevi merce» (oppure dall'ordine → «Registra arrivo merce»). Inserisci quantità e prezzi e lascia attiva «Registra anche la fattura». Il magazzino e la spesa da pagare vengono creati insieme, senza doppio conteggio del costo. Fotografa la fattura e allegala alla spesa.
- **Bonifico delle piattaforme**: Incassi → Da incassare → seleziona le vendite → «Registra accredito» con l'importo arrivato in banca. La differenza rispetto al lordo mostra quanto ha trattenuto la piattaforma.
- **Pagamenti**: la dashboard elenca le scadenze. Apri la spesa → «Registra pagamento». Sono possibili anche pagamenti parziali.
- **Sprechi**: Magazzino → articolo → «Spreco», indicando se è scaduto, danneggiato o sprecato.

## Ogni mese
1. **Inventario fisico** (Magazzino → Inventari fisici): conta la merce e conferma. Le differenze diventano rettifiche con il loro valore. In Report → Analisi vedi il consumo teorico confrontato con sprechi e differenze.
2. **Report → Conto economico**: scegli il mese.
   - Clicca su qualsiasi voce per vedere le operazioni che la compongono.
   - Controlla che i «Controlli automatici» siano verdi.
   - Scarica PDF ed Excel per il commercialista.
3. **Chiudi il mese** (pulsante nella stessa pagina). Da quel momento nessuno può modificare le registrazioni di quel mese. Si può riaprire, e la riapertura resta tracciata.

## Leggere i numeri
- **Vendite (IVA inclusa)**: quanto hai battuto.
- **Ricavi netti**: le vendite senza IVA, al netto di sconti e rimborsi. È la base del conto economico.
- **Margine lordo**: ricavi meno materie prime effettivamente consumate.
- **Risultato operativo**: margine meno commissioni, costi fissi, personale e altri costi. Su periodi di pochi giorni affitto e stipendi sono ripartiti per giorni.
- **Liquidità**: i soldi davvero entrati e usciti. È diversa dal risultato: un bonifico Glovo arriva giorni dopo la vendita, e una fattura si paga a 30 o 60 giorni.
- **Punto di pareggio** (Report → Analisi): quanto devi vendere al mese, e al giorno, per coprire tutti i costi. Sotto il valore trovi le ipotesi usate.

Tutti i valori sono una **stima gestionale**: il bilancio fiscale resta compito del commercialista. I criteri di calcolo sono in Impostazioni.

## Sicurezza
- Non condividere le credenziali: ogni operazione è registrata con il nome di chi la fa (Utenti → Registro attività).
- Se un collaboratore lascia l'azienda: Utenti → apri l'utente → togli la spunta a «Utente attivo». Viene disconnesso subito da tutti i dispositivi.
- Password dimenticata: l'amministratore genera un «Link nuova password» dalla scheda dell'utente.
