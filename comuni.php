<?php
/* Elenco comuni italiani (nome, provincia, codice catastale) per il calcolo del codice fiscale.
   Scaricato una volta dal registro pubblico e salvato sul server per 90 giorni. */
declare(strict_types=1);
define('MAGI_NO_ROUTES', true);
ob_start();
require __DIR__ . '/api.php';
ob_end_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=86400');

$cache = data_dir() . '/comuni.json';
if (is_file($cache) && filemtime($cache) > time() - 90 * 86400) { readfile($cache); exit; }

$src = 'https://cdn.jsdelivr.net/gh/matteocontrini/comuni-json@master/comuni.json';
$raw = false;
if (function_exists('curl_init')) {
    $ch = curl_init($src);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 25, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => true]);
    $raw = curl_exec($ch);
    if (curl_getinfo($ch, CURLINFO_HTTP_CODE) >= 400) $raw = false;
    curl_close($ch);
}
if ($raw === false && ini_get('allow_url_fopen')) $raw = @file_get_contents($src);
$list = [];
if ($raw) {
    foreach ((json_decode($raw, true) ?: []) as $c) {
        if (!empty($c['nome']) && !empty($c['sigla']) && !empty($c['codiceCatastale'])) $list[] = [$c['nome'], $c['sigla'], $c['codiceCatastale']];
    }
}
if (count($list) > 7000) {
    $json = json_encode($list, JSON_UNESCAPED_UNICODE);
    @file_put_contents($cache, $json);
    echo $json; exit;
}
if (is_file($cache)) { readfile($cache); exit; } // vecchia copia meglio di niente
http_response_code(503);
echo '[]';
