<?php
/* Controllo giornaliero scadenze (revisione / assicurazione).
   Plesk → Attività pianificate: esegui ogni giorno alle 8:00 lo script PHP "httpdocs/cron.php"
   oppure apri l'URL https://www.magirent.com/cron.php?key=CHIAVE (vedi config.php). */
declare(strict_types=1);
define('MAGI_NO_ROUTES', true);
if (PHP_SAPI !== 'cli') {
    require_once __DIR__ . '/config.php';
    if (!hash_equals(CRON_KEY, (string)($_GET['key'] ?? ''))) { http_response_code(403); exit('Chiave non valida'); }
}
$_SERVER['REQUEST_METHOD'] = $_SERVER['REQUEST_METHOD'] ?? 'GET';
ob_start();
require __DIR__ . '/api.php';
ob_end_clean();
header_remove('Content-Type');
if (PHP_SAPI !== 'cli') header('Content-Type: text/plain; charset=utf-8');
$r = expiry_check();
echo date('Y-m-d H:i') . ' ' . json_encode($r) . "\n";
