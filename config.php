<?php
/* =========================================================
   MA.GI. RENT — impostazioni
   Di solito non serve cambiare nulla qui.
   ========================================================= */

// Codice da inserire la PRIMA volta che apri il gestionale, per creare la password.
const SETUP_CODE = 'MG-C424B5';

// Dove arrivano gli avvisi delle nuove prenotazioni.
const NOTIFY_EMAIL = 'magirentsrl@gmail.com';
// Mittente delle email (deve essere del vostro dominio).
const MAIL_FROM = 'prenotazioni@magirent.com';

// Quanti giorni prima della scadenza di revisione e assicurazione arriva l'avviso WhatsApp/email.
const ALERT_DAYS = 15;
// Chiave per l'attività pianificata di Plesk (cron.php?key=...).
const CRON_KEY = 'mgk-eJT7WpHhFltKz854';

// Database: lasciare vuoto per usare il database interno (SQLite, nessuna configurazione).
// Per usare MySQL di Plesk, compilare questi 4 campi.
const MYSQL_HOST = '';
const MYSQL_DB   = '';
const MYSQL_USER = '';
const MYSQL_PASS = '';

const SITE_NAME = 'MA.GI. Rent';
const SITE_URL  = 'https://www.magirent.com';
