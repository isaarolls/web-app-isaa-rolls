# App per iPhone e Android

L'app per telefono è l'interfaccia di Isa Manager impacchettata con **Capacitor**. Si collega al tuo server online, quindi **prima va completata la pubblicazione web** (`PUBBLICAZIONE.md`). Telefono, tablet e computer vedono gli stessi dati in tempo reale.

## Prima di iniziare: quale distribuzione scegliere

Isa Manager è un'app **ad uso interno**, accessibile solo con credenziali aziendali. Gli store pubblici accettano con difficoltà le app che servono solo ai dipendenti di un'azienda. Le strade realistiche sono:

| | iPhone | Android |
|---|---|---|
| **Consigliata** | **App non in elenco (Unlisted)**: approvata da Apple, si scarica solo con il link diretto. Oppure **Custom App** tramite Apple Business Manager. | **Test chiuso** su Google Play (fino a 100 tester via e-mail) oppure **app privata** tramite Managed Google Play. |
| Alternativa immediata, gratuita | Safari → Condividi → **Aggiungi alla schermata Home**: l'app web si installa con icona e schermo intero. | Chrome → menu → **Installa app**. |
| Costo | Apple Developer Program: 99 $/anno | Google Play Console: 25 $ una tantum |

Per partire subito usa l'alternativa immediata: è già funzionante, con l'icona Isaa Rolls. Il passaggio agli store si fa con calma.

## 👤 Cosa ti serve
- Un **Mac** con Xcode, obbligatorio per compilare l'app iPhone. Se non ne hai uno puoi usare un servizio di build in cloud, ad esempio Ionic Appflow o Codemagic.
- **Android Studio**, su Windows o Mac.
- Gli account sviluppatore Apple e Google indicati sopra, intestati all'azienda.
- Un **account dimostrativo** per i revisori di Apple e Google. Consiglio un utente con ruolo «Dipendente (solo vendite)» in un ambiente di prova.
- L'indirizzo della **privacy policy**: `https://gestionale.tuodominio.it/privacy.html`. Il file è già incluso; va completato con i dati dell'azienda.

## Passaggi (da eseguire nella cartella `web`)
```bash
npm install
# l'app usa le pagine incluse e chiama l'API sul tuo server:
ISA_API_BASE=https://gestionale.isaarolls.it node build.mjs

npx cap add ios
npx cap add android
npx cap sync

# icone e schermata di avvio generate dal logo
npm install -D @capacitor/assets
mkdir -p assets && cp public/icon-512.png assets/icon.png && cp public/logo.png assets/splash.png
npx capacitor-assets generate --iconBackgroundColor '#8bbfb9' --splashBackgroundColor '#183533'

npx cap open ios       # apre Xcode
npx cap open android   # apre Android Studio
```

### iPhone (Xcode)
1. **Signing & Capabilities**: scegli il tuo Team Apple. Il Bundle ID è `it.isaarolls.manager`.
2. **Product → Archive → Distribute App → App Store Connect**.
3. Su App Store Connect:
   - compila la scheda dell'app: nome, descrizione, privacy policy, account dimostrativo per la revisione;
   - invia alla revisione.
4. Per la distribuzione «Unlisted», dopo l'approvazione richiedila ad Apple con il modulo dedicato. Per una Custom App, scegli invece «Private availability» in App Store Connect.

### Android (Android Studio)
1. **Build → Generate Signed App Bundle**. Crea la chiave di firma e **conservala**: senza la chiave non potrai pubblicare aggiornamenti.
2. Su Play Console:
   - crea l'app;
   - carica il file `.aab` in **Test → Test chiuso**;
   - aggiungi le e-mail dei collaboratori;
   - compila la scheda con privacy policy e sicurezza dei dati.

## Aggiornamenti dell'app
Le modifiche alle schermate richiedono di ripetere `node build.mjs` e `npx cap sync`, poi una nuova versione sugli store. Le modifiche al server, ai calcoli e ai dati valgono subito per tutti, senza aggiornare l'app.

## Note tecniche
- Nell'app nativa l'accesso usa un token personale, salvato sul dispositivo, al posto del cookie. Il logout lo cancella.
- Il server accetta richieste solo dalle origini dell'app (`capacitor://localhost`, `https://localhost`). Sono configurabili con `CORS_ORIGINS`.
- La foto delle fatture (Spese → Allega) usa direttamente la fotocamera del telefono.
