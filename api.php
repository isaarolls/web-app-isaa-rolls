<?php
/* MA.GI. RENT — API del sito e del gestionale */
declare(strict_types=1);
require_once __DIR__ . '/config.php';
ini_set('display_errors', '0');
date_default_timezone_set('Europe/Rome');

session_name('magisess');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ---------- storage ---------- */
function data_dir(): string {
    static $d = null;
    if ($d) return $d;
    $outside = dirname(__DIR__) . '/magirent_private';
    if ((is_dir($outside) || @mkdir($outside, 0750, true)) && is_writable($outside)) {
        $d = $outside;
    } else {
        $d = __DIR__ . '/data';
        if (!is_dir($d)) @mkdir($d, 0750, true);
    }
    if (!is_dir($d . '/docs')) @mkdir($d . '/docs', 0750, true);
    if (!file_exists($d . '/.htaccess')) {
        @file_put_contents($d . '/.htaccess', "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }
    return $d;
}

function db(): PDO {
    static $p = null;
    if ($p) return $p;
    $opt = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
    if (MYSQL_HOST !== '') {
        $p = new PDO('mysql:host=' . MYSQL_HOST . ';dbname=' . MYSQL_DB . ';charset=utf8mb4', MYSQL_USER, MYSQL_PASS, $opt);
        $p->exec('CREATE TABLE IF NOT EXISTS items (coll VARCHAR(20) NOT NULL, id VARCHAR(64) NOT NULL, data LONGTEXT NOT NULL, PRIMARY KEY (coll, id)) DEFAULT CHARSET=utf8mb4');
    } else {
        $p = new PDO('sqlite:' . data_dir() . '/magirent.sqlite', null, null, $opt);
        $p->exec('PRAGMA busy_timeout = 5000');
        $p->exec('CREATE TABLE IF NOT EXISTS items (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (coll, id))');
    }
    if (!$p->query("SELECT COUNT(*) FROM items WHERE coll='settings'")->fetchColumn()) seed($p);
    return $p;
}

function seed(PDO $p): void {
    $base = ['colore' => 'Bianco', 'alimentazione' => 'Diesel', 'cambio' => 'Manuale', 'posti' => 3, 'patente' => 'B', 'prezzo' => '', 'targa' => '', 'km' => '',
        'gommeData' => '', 'gommeKm' => '', 'tagliandoData' => '', 'tagliandoKm' => '', 'revisione' => '', 'assicurazione' => '', 'bollo' => '', 'sito' => true, 'tipo' => 'Furgone', 'foto' => ''];
    $v = [
        ['id' => 'v-jumper-medio', 'marca' => 'Citroën', 'modello' => 'Jumper passo medio', 'carico' => '≈ 11 m³', 'foto' => 'img/mezzi/jumper-medio.jpg'],
        ['id' => 'v-jumper-lungo', 'marca' => 'Citroën', 'modello' => 'Jumper passo lungo', 'carico' => '≈ 13 m³'],
        ['id' => 'v-daily-lungo', 'marca' => 'Iveco', 'modello' => 'Daily passo lungo', 'carico' => '≈ 16 m³', 'foto' => 'img/mezzi/daily-lungo.jpg'],
        ['id' => 'v-daily-cassonato', 'marca' => 'Iveco', 'modello' => 'Daily cassonato', 'carico' => 'Cassone chiuso (box)', 'foto' => 'img/mezzi/daily-cassonato.jpg'],
        ['id' => 'v-sandero', 'marca' => 'Dacia', 'modello' => 'Sandero', 'carico' => '', 'tipo' => 'Auto', 'posti' => 5, 'alimentazione' => 'Benzina', 'foto' => 'img/mezzi/sandero.jpg'],
    ];
    foreach ($v as $x) put_item('vehicles', array_merge($base, ['note' => 'Completa targa, km, prezzo e scadenze'], $x), $p);
    put_item('settings', ['id' => 'main', 'pwhash' => '', 'wa' => []], $p);
}

function all_items(string $coll): array {
    $st = db()->prepare('SELECT id, data FROM items WHERE coll = ?');
    $st->execute([$coll]);
    $out = [];
    foreach ($st as $r) { $o = json_decode($r['data'], true) ?: []; $o['id'] = $r['id']; $out[] = $o; }
    return $out;
}
function get_item(string $coll, string $id): ?array {
    $st = db()->prepare('SELECT data FROM items WHERE coll = ? AND id = ?');
    $st->execute([$coll, $id]);
    $r = $st->fetchColumn();
    if ($r === false) return null;
    $o = json_decode($r, true) ?: []; $o['id'] = $id; return $o;
}
function put_item(string $coll, array $o, ?PDO $p = null): void {
    $p = $p ?: db();
    $id = (string)$o['id'];
    $st = $p->prepare('REPLACE INTO items (coll, id, data) VALUES (?, ?, ?)');
    $st->execute([$coll, $id, json_encode($o, JSON_UNESCAPED_UNICODE)]);
}
function del_item(string $coll, string $id): void {
    db()->prepare('DELETE FROM items WHERE coll = ? AND id = ?')->execute([$coll, $id]);
}
function settings(): array { return get_item('settings', 'main') ?: ['id' => 'main', 'pwhash' => '', 'wa' => []]; }

/* ---------- helpers ---------- */
function out($x, int $code = 200): void { http_response_code($code); echo json_encode($x, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function body(): array { static $b = null; if ($b === null) { $b = json_decode(file_get_contents('php://input') ?: '[]', true); if (!is_array($b)) $b = []; } return $b; }
function in(string $k, $def = '') { $b = body(); $v = $_POST[$k] ?? $b[$k] ?? $def; return is_string($v) ? trim($v) : $v; }
function new_id(string $p): string { return $p . bin2hex(random_bytes(6)); }
function is_date($s): bool { return is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && checkdate((int)substr($s, 5, 2), (int)substr($s, 8, 2), (int)substr($s, 0, 4)); }
function giorni(string $a, string $b): int { return max(1, (int)round((strtotime($b) - strtotime($a)) / 86400)); }
const ACTIVE = ['richiesta', 'confermato', 'in corso'];
function shop_range(?array $v): ?array { // vehicle at the mechanic
    if (!$v || empty($v['officina'])) return null;
    $a = is_date($v['officinaDal'] ?? '') ? $v['officinaDal'] : date('Y-m-d');
    $b = is_date($v['officinaAl'] ?? '') ? $v['officinaAl'] : date('Y-m-d', strtotime('+2 years'));
    return [$a, $b];
}
function is_free(string $vid, string $a, string $b, string $except = ''): bool {
    $r = shop_range(get_item('vehicles', $vid));
    if ($r && $r[0] <= $b && $r[1] >= $a) return false;
    foreach (all_items('bookings') as $x) {
        if ($x['id'] === $except || ($x['vehicleId'] ?? '') !== $vid || !in_array($x['stato'] ?? '', ACTIVE, true)) continue;
        if (($x['dal'] ?? '') <= $b && ($x['al'] ?? '') >= $a) return false;
    }
    return true;
}
function price_for(array $v, ?array $c): float {
    $base = (float)($v['prezzo'] ?: 0);
    if ($c) {
        $pp = $c['prezzi'][$v['id']] ?? '';
        if ($pp !== '' && $pp !== null) return (float)$pp;
        if (!empty($c['sconto'])) return round($base * (1 - (float)$c['sconto'] / 100), 2);
    }
    return $base;
}
function current_client(): ?array { return !empty($_SESSION['client']) ? get_item('clients', $_SESSION['client']) : null; }
function km_cfg(): array { $s = settings(); return ['inclusi' => (int)($s['kmInclusi'] ?? 100) ?: 100, 'costo' => (float)($s['costoKm'] ?? 0.20), 'suppl' => (float)($s['supplIllimitati'] ?? 0)]; }
function suppl_for(array $v): float { $x = $v['supplIllimitati'] ?? ''; return ($x === '' || $x === null) ? km_cfg()['suppl'] : (float)$x; }
const REM_COOKIE = 'magirem';
function remember_set(): void {
    $tok = bin2hex(random_bytes(32)); $s = settings();
    $list = array_values(array_filter($s['tokens'] ?? [], fn($t) => ($t['exp'] ?? 0) > time()));
    $list[] = ['h' => hash('sha256', $tok), 'exp' => time() + 180 * 86400];
    $s['tokens'] = array_slice($list, -20); put_item('settings', $s);
    setcookie(REM_COOKIE, $tok, ['expires' => time() + 180 * 86400, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
}
function remember_clear(): void {
    $tok = (string)($_COOKIE[REM_COOKIE] ?? '');
    if ($tok !== '') { $s = settings(); $h = hash('sha256', $tok); $s['tokens'] = array_values(array_filter($s['tokens'] ?? [], fn($t) => ($t['h'] ?? '') !== $h)); put_item('settings', $s); }
    setcookie(REM_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
}
function remember_check(): void {
    if (!empty($_SESSION['admin'])) return;
    $tok = (string)($_COOKIE[REM_COOKIE] ?? '');
    if (strlen($tok) !== 64) return;
    $h = hash('sha256', $tok);
    foreach ((settings()['tokens'] ?? []) as $t) if (hash_equals((string)($t['h'] ?? ''), $h) && ($t['exp'] ?? 0) > time()) { session_regenerate_id(true); $_SESSION['admin'] = true; return; }
}
function is_admin(): bool { remember_check(); return !empty($_SESSION['admin']); }
function require_admin(): void {
    if (!is_admin()) fail('Accesso richiesto', 401);
    if (($_SERVER['HTTP_X_MG'] ?? '') !== '1') fail('Richiesta non valida', 403);
}
const DOC_TYPES = ['image/jpeg' => '.bin', 'image/png' => '.bin', 'image/webp' => '.bin', 'image/heic' => '.bin', 'image/heif' => '.bin', 'application/pdf' => '.bin'];
function cleanup_docs(array $files): void { // delete document files no longer referenced anywhere
    if (!$files) return;
    $used = [];
    foreach (['bookings', 'clients'] as $cl) foreach (all_items($cl) as $x) foreach (($x['docs'] ?? []) as $list) foreach ((array)$list as $d) $used[$d['f'] ?? ''] = 1;
    foreach ($files as $f) if ($f && empty($used[$f]) && preg_match('/^[a-f0-9]{32}\.bin$/', $f)) @unlink(data_dir() . '/docs/' . $f);
}
function norm_cell(string $s): string { $d = preg_replace('/\D/', '', $s); if (strlen($d) > 10 && str_starts_with($d, '0039')) $d = substr($d, 4); elseif (strlen($d) > 10 && str_starts_with($d, '39')) $d = substr($d, 2); return $d; }
const CLIENT_FIELDS = ['cognome' => 'Cognome', 'nome' => 'Nome', 'sesso' => 'Sesso', 'cf' => 'Codice fiscale', 'indirizzo' => 'Indirizzo', 'citta' => 'Città', 'cap' => 'CAP', 'prov' => 'Provincia',
    'cell' => 'Cellulare', 'email' => 'Email', 'luogoNascita' => 'Luogo di nascita', 'dataNascita' => 'Data di nascita',
    'nPatente' => 'Numero patente', 'enteRilascio' => 'Ente di rilascio', 'dataRilascio' => 'Data di rilascio', 'dataScad' => 'Scadenza patente'];
function client_out(array $c): array { $c['hasPassword'] = !empty($c['pwhash']); unset($c['pwhash'], $c['pin']); return $c; }
function has_docs(?array $o): bool { return $o && !empty($o['docs']['ci']) && !empty($o['docs']['pat']); }
function it_date(string $d): string { return $d ? implode('/', array_reverse(explode('-', $d))) : ''; }

function save_upload(array $f, array $allowed, string $dir, int $maxMb = 12): ?array {
    if (($f['error'] ?? 1) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) return null;
    if ($f['size'] > $maxMb * 1024 * 1024) return null;
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) ?: '';
    if (!isset($allowed[$mime])) return null;
    $name = bin2hex(random_bytes(16)) . $allowed[$mime];
    if (!move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) return null;
    @chmod($dir . '/' . $name, 0640);
    return ['f' => $name, 'nome' => mb_substr(basename((string)$f['name']), 0, 80), 'tipo' => $mime];
}
function files_of(string $key): array {
    if (empty($_FILES[$key])) return [];
    $F = $_FILES[$key]; $out = [];
    if (is_array($F['name'])) { foreach ($F['name'] as $i => $n) $out[] = ['name' => $n, 'type' => $F['type'][$i], 'tmp_name' => $F['tmp_name'][$i], 'error' => $F['error'][$i], 'size' => $F['size'][$i]]; }
    else $out[] = $F;
    return array_slice($out, 0, 4);
}

function send_all(string $subject, string $txt, string $replyTo = ''): array {
    $res = ['email' => false, 'wa' => 0];
    $headers = 'From: ' . SITE_NAME . ' <' . MAIL_FROM . ">\r\n" . 'Content-Type: text/plain; charset=UTF-8' . "\r\n";
    if ($replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) $headers .= 'Reply-To: ' . $replyTo . "\r\n";
    $res['email'] = @mail(NOTIFY_EMAIL, '=?UTF-8?B?' . base64_encode($subject) . '?=', $txt, $headers, '-f' . MAIL_FROM);
    foreach ((settings()['wa'] ?? []) as $w) {
        if (empty($w['phone']) || empty($w['apikey']) || !function_exists('curl_init')) continue;
        $url = 'https://api.callmebot.com/whatsapp.php?phone=' . urlencode($w['phone']) . '&text=' . urlencode($txt) . '&apikey=' . urlencode($w['apikey']);
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5]);
        $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($r !== false && $code < 400) $res['wa']++;
        if (count(settings()['wa'] ?? []) > 1) usleep(300000);
    }
    return $res;
}
function notify(array $b, array $v): array {
    $txt = "Nuova richiesta di noleggio dal sito\n\n"
        . "Mezzo: {$v['marca']} {$v['modello']}" . (!empty($v['targa']) ? " ({$v['targa']})" : '') . "\n"
        . 'Dal ' . it_date($b['dal']) . ' al ' . it_date($b['al']) . ' - ritiro ore ' . ($b['oraInizio'] ?? '') . "\n"
        . (!empty($b['kmFormula']) ? ($b['kmFormula'] === 'illimitati' ? "Km: illimitati\n" : "Km: {$b['kmInclusiGiorno']} al giorno inclusi, extra € " . number_format((float)$b['costoKm'], 2, ',', '.') . "/km\n") : '')
        . "Cliente: {$b['cognomeNome']}\nCellulare: {$b['cell']}\n" . (!empty($b['email']) ? "Email: {$b['email']}\n" : '')
        . 'Importo indicativo: ' . ($b['prezzo'] ? '€ ' . number_format((float)$b['prezzo'], 2, ',', '.') : 'da definire') . "\n\n"
        . 'Apri il gestionale: ' . SITE_URL . '/gestionale';
    return send_all('Nuova prenotazione: ' . $v['marca'] . ' ' . $v['modello'] . ' dal ' . it_date($b['dal']), $txt, (string)($b['email'] ?? ''));
}
/* Daily check of vehicle deadlines: one WhatsApp + email when revisione / assicurazione expire within ALERT_DAYS. */
function expiry_check(bool $force = false): array {
    $s = settings();
    if (!$force && ($s['lastCheck'] ?? '') === date('Y-m-d')) return ['skipped' => true];
    $s['lastCheck'] = date('Y-m-d'); put_item('settings', $s);
    $today = date('Y-m-d'); $lines = [];
    $types = ['revisione' => 'Revisione', 'assicurazione' => 'Assicurazione'];
    foreach (all_items('vehicles') as $v) {
        foreach ($types as $k => $label) {
            $d = $v[$k] ?? '';
            if (!is_date($d)) continue;
            $days = (int)round((strtotime($d) - strtotime($today)) / 86400);
            if ($days > ALERT_DAYS) continue;
            $mid = 'a-' . substr(hash('sha256', $v['id'] . '|' . $k . '|' . $d), 0, 24);
            if (get_item('alerts', $mid)) continue; // already notified for this deadline
            $when = $days > 1 ? "tra {$days} giorni" : ($days === 1 ? 'domani' : ($days === 0 ? 'OGGI' : 'è SCADUTA da ' . (-$days) . ' giorni'));
            $lines[] = "• {$label} {$v['marca']} {$v['modello']}" . (!empty($v['targa']) ? " ({$v['targa']})" : '') . ': ' . it_date($d) . " – {$when}";
            put_item('alerts', ['id' => $mid, 'vehicleId' => $v['id'], 'tipo' => $k, 'data' => $d, 'inviato' => date('c')]);
        }
    }
    if (!$lines) return ['sent' => 0];
    $txt = "Promemoria scadenze MA.GI. Rent\n\n" . implode("\n", $lines) . "\n\nAggiorna la data nel gestionale quando l'hai rinnovata: " . SITE_URL . '/gestionale';
    $r = send_all('Scadenze mezzi: ' . count($lines) . ' in arrivo', $txt);
    return ['sent' => count($lines)] + $r;
}

const PUBLIC_V = ['id', 'tipo', 'marca', 'modello', 'colore', 'alimentazione', 'cambio', 'posti', 'carico', 'patente', 'foto'];

/* ---------- routes ---------- */
if (defined('MAGI_NO_ROUTES')) return;
$a = $_GET['a'] ?? '';
try {
    switch ($a) {

    case 'public': {
        try { expiry_check(); } catch (Throwable $e) { error_log('magirent check: ' . $e->getMessage()); }
        $c = current_client();
        $vs = []; $busy = [];
        foreach (all_items('vehicles') as $v) {
            if (($v['sito'] ?? true) === false) continue;
            $o = array_intersect_key($v, array_flip(PUBLIC_V));
            $o['listino'] = (float)($v['prezzo'] ?: 0);
            $sr = shop_range($v);
            if ($sr) { $busy[$v['id']][] = $sr; $o['officina'] = $sr[0] <= date('Y-m-d') && $sr[1] >= date('Y-m-d'); }
            $o['prezzo'] = price_for($v, $c);
            $o['suppl'] = suppl_for($v);
            $vs[] = $o;
        }
        usort($vs, fn($x, $y) => strcmp(($x['tipo'] ?? '') . $x['modello'], ($y['tipo'] ?? '') . $y['modello']) * -1);
        foreach (all_items('bookings') as $b) {
            if (!in_array($b['stato'] ?? '', ACTIVE, true)) continue;
            $busy[$b['vehicleId']][] = [$b['dal'], $b['al']];
        }
        out(['vehicles' => $vs, 'busy' => $busy, 'km' => km_cfg(), 'me' => $c ? ['nome' => $c['cognomeNome'], 'cell' => $c['cell'] ?? '', 'email' => $c['email'] ?? '', 'hasDocs' => has_docs($c)] : null]);
    }

    case 'client_login': {
        $cell = norm_cell((string)in('cell')); $pw = (string)in('password');
        if (strlen($cell) < 8 || $pw === '') fail('Inserisci cellulare e password');
        $lk = 'l-' . substr(hash('sha256', $cell), 0, 20);
        $lock = get_item('loginfail', $lk) ?: ['id' => $lk, 'n' => 0, 't' => 0];
        if ($lock['n'] >= 6 && $lock['t'] > time() - 1800) fail('Troppi tentativi. Riprova tra mezz\'ora o chiamaci al 338 163 0369.', 429);
        foreach (all_items('clients') as $c) {
            if (norm_cell((string)($c['cell'] ?? '')) === $cell && !empty($c['pwhash']) && password_verify($pw, $c['pwhash'])) {
                del_item('loginfail', $lk);
                session_regenerate_id(true); $_SESSION['client'] = $c['id']; out(['ok' => true]);
            }
        }
        $lock['n'] = ($lock['t'] > time() - 1800 ? $lock['n'] : 0) + 1; $lock['t'] = time(); put_item('loginfail', $lock);
        sleep(1); fail('Cellulare o password non corretti');
    }
    case 'client_logout': unset($_SESSION['client']); out(['ok' => true]);
    case 'client_register': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Metodo non valido', 405);
        $_SESSION['rg'] = array_values(array_filter($_SESSION['rg'] ?? [], fn($t) => $t > time() - 3600));
        if (count($_SESSION['rg']) >= 3) fail('Troppe registrazioni. Riprova più tardi.', 429);
        $f = [];
        foreach (CLIENT_FIELDS as $k => $label) {
            $f[$k] = mb_substr(trim((string)in($k)), 0, 120);
            if ($f[$k] === '') fail("Compila il campo «{$label}»");
        }
        $cell = norm_cell($f['cell']); $pw = (string)in('password');
        if (strlen($cell) < 8) fail('Cellulare non valido');
        if (!filter_var($f['email'], FILTER_VALIDATE_EMAIL)) fail('Email non valida');
        $f['cf'] = strtoupper(preg_replace('/\s/', '', $f['cf']));
        if (!preg_match('/^[A-Z0-9]{16}$/', $f['cf'])) fail('Il codice fiscale deve avere 16 caratteri');
        foreach (['dataNascita', 'dataRilascio', 'dataScad'] as $k) if (!is_date($f[$k])) fail('Data non valida: ' . CLIENT_FIELDS[$k]);
        if ($f['dataScad'] < date('Y-m-d')) fail('La patente risulta scaduta');
        if (!in_array($f['sesso'], ['M', 'F'], true)) fail('Indica il sesso');
        $f['cognomeNome'] = trim($f['cognome'] . ' ' . $f['nome']);
        if (mb_strlen($pw) < 6) fail('La password deve avere almeno 6 caratteri');
        foreach (all_items('clients') as $x) if (norm_cell((string)($x['cell'] ?? '')) === $cell) {
            fail(!empty($x['pwhash']) ? 'Questo cellulare è già registrato: usa «Accedi».' : 'Sei già nostro cliente: chiamaci al 338 163 0369 per attivare la password.');
        }
        if (!files_of('ci') || !files_of('pat')) fail("Carica le foto della carta d'identità e della patente (fronte e retro).");
        $docs = ['ci' => [], 'pat' => []];
        foreach (['ci', 'pat'] as $k) foreach (files_of($k) as $file) { $sv = save_upload($file, DOC_TYPES, data_dir() . '/docs'); if ($sv) $docs[$k][] = $sv; }
        if (!$docs['ci'] || !$docs['pat']) {
            foreach ($docs as $list) foreach ($list as $d) @unlink(data_dir() . '/docs/' . $d['f']);
            fail("Le foto dei documenti non sono valide (JPG, PNG o PDF, max 12 MB).");
        }
        $c = $f + ['id' => new_id('c-'), 'pwhash' => password_hash($pw, PASSWORD_DEFAULT), 'sconto' => 0, 'prezzi' => (object)[], 'docs' => $docs, 'origine' => 'sito', 'creato' => date('c')];
        put_item('clients', $c);
        $_SESSION['rg'][] = time();
        session_regenerate_id(true); $_SESSION['client'] = $c['id'];
        out(['ok' => true]);
    }
    case 'client_password': {
        $c = current_client();
        if (!$c) fail('Accedi di nuovo', 401);
        if (empty($c['pwhash']) || !password_verify((string)in('old'), $c['pwhash'])) { sleep(1); fail('Password attuale errata'); }
        if (mb_strlen((string)in('new')) < 6) fail('La nuova password deve avere almeno 6 caratteri');
        $c['pwhash'] = password_hash((string)in('new'), PASSWORD_DEFAULT); put_item('clients', $c); out(['ok' => true]);
    }

    case 'book': {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Metodo non valido', 405);
        if (in('website') !== '') out(['ok' => true]); // anti-spam
        $_SESSION['bk'] = array_values(array_filter($_SESSION['bk'] ?? [], fn($t) => $t > time() - 3600));
        if (count($_SESSION['bk']) >= 5) fail('Troppe richieste. Chiamaci al 338 163 0369.', 429);
        $v = get_item('vehicles', (string)in('vehicleId'));
        if (!$v || ($v['sito'] ?? true) === false) fail('Mezzo non disponibile');
        $dal = in('dal'); $al = in('al');
        if (!is_date($dal) || !is_date($al) || $al < $dal || $dal < date('Y-m-d')) fail('Date non valide');
        $nome = mb_substr((string)in('nome'), 0, 80); $cell = mb_substr((string)in('cell'), 0, 30); $email = mb_substr((string)in('email'), 0, 120);
        if ($nome === '' || strlen(preg_replace('/\D/', '', $cell)) < 6) fail('Inserisci nome e cellulare');
        $ora = preg_match('/^\d{2}:\d{2}$/', (string)in('ora')) ? in('ora') : '09:00';
        if (!is_free($v['id'], $dal, $al)) fail('Queste date non sono più libere. Scegline altre.');
        $c = current_client();
        if (!has_docs($c) && (!files_of('ci') || !files_of('pat'))) fail("Carica le foto della carta d'identità e della patente.");
        $docs = ['ci' => [], 'pat' => []];
        foreach (['ci', 'pat'] as $k) foreach (files_of($k) as $f) { $s = save_upload($f, DOC_TYPES, data_dir() . '/docs'); if ($s) $docs[$k][] = $s; }
        foreach (['ci', 'pat'] as $k) if (!$docs[$k] && has_docs($c)) $docs[$k] = $c['docs'][$k];
        if (!$docs['ci'] || !$docs['pat']) {
            foreach ($docs as $list) foreach ($list as $d) @unlink(data_dir() . '/docs/' . $d['f']);
            fail("Le foto della carta d'identità e della patente non sono valide (JPG, PNG o PDF, max 12 MB).");
        }
        $kc = km_cfg(); $kmF = in('km') === 'illimitati' ? 'illimitati' : 'inclusi';
        $pd = price_for($v, $c); $prezzoTot = $pd > 0 ? giorni($dal, $al) * ($pd + ($kmF === 'illimitati' ? suppl_for($v) : 0)) : 0;
        $extra = [];
        if ($c) foreach (array_keys(CLIENT_FIELDS) as $k) if (!empty($c[$k]) && !in_array($k, ['cognomeNome', 'cell', 'email'], true)) $extra[$k] = $c[$k];
        $b = $extra + ['id' => new_id('b-'), 'vehicleId' => $v['id'], 'clienteId' => $c['id'] ?? '', 'dal' => $dal, 'al' => $al, 'oraInizio' => $ora,
            'stato' => 'richiesta', 'origine' => 'sito', 'cognomeNome' => $nome, 'cell' => $cell, 'email' => $email,
            'prezzo' => $prezzoTot, 'kmFormula' => $kmF, 'kmInclusiGiorno' => $kc['inclusi'], 'costoKm' => $kc['costo'], 'supplIllimitati' => $kmF === 'illimitati' ? suppl_for($v) : 0,
            'docs' => $docs, 'creato' => date('c')];
        put_item('bookings', $b);
        $_SESSION['bk'][] = time();
        notify($b, $v);
        out(['ok' => true]);
    }

    /* ----- admin ----- */
    case 'admin_state': out(['setup' => settings()['pwhash'] !== '', 'logged' => is_admin()]);

    case 'admin_setup': {
        $s = settings();
        if ($s['pwhash'] !== '') fail('Password già creata');
        if (!hash_equals(SETUP_CODE, (string)in('code'))) { sleep(2); fail('Codice di attivazione errato'); }
        $pw = (string)in('password');
        if (mb_strlen($pw) < 8) fail('La password deve avere almeno 8 caratteri');
        $s['pwhash'] = password_hash($pw, PASSWORD_DEFAULT); put_item('settings', $s);
        session_regenerate_id(true); $_SESSION['admin'] = true; remember_set(); out(['ok' => true]);
    }
    case 'admin_login': {
        $s = settings();
        if ($s['pwhash'] === '' || !password_verify((string)in('password'), $s['pwhash'])) { sleep(2); fail('Password errata', 401); }
        session_regenerate_id(true); $_SESSION['admin'] = true;
        if (in('remember', true)) remember_set();
        out(['ok' => true]);
    }
    case 'admin_logout': remember_clear(); unset($_SESSION['admin']); out(['ok' => true]);

    case 'admin_all': {
        require_admin();
        try { expiry_check(); } catch (Throwable $e) { error_log('magirent check: ' . $e->getMessage()); }
        $s = settings();
        out(['vehicles' => all_items('vehicles'), 'bookings' => all_items('bookings'), 'clients' => array_map('client_out', all_items('clients')), 'crediti' => all_items('crediti'), 'km' => km_cfg(), 'wa' => $s['wa'] ?? [], 'notifyEmail' => NOTIFY_EMAIL]);
    }
    case 'admin_save': {
        require_admin();
        $coll = in('coll'); $o = body()['obj'] ?? null;
        if (!in_array($coll, ['vehicles', 'bookings', 'clients', 'crediti'], true) || !is_array($o)) fail('Dati non validi');
        if (in_array($coll, ['bookings', 'clients'], true)) { $jn = trim(trim((string)($o['cognome'] ?? '')) . ' ' . trim((string)($o['nome'] ?? ''))); if ($jn !== '') $o['cognomeNome'] = $jn; }
        if (isset($o['pagamenti']) && is_array($o['pagamenti'])) $o['pagamenti'] = array_values(array_filter(array_map(fn($p) => is_array($p) && is_date($p['data'] ?? '') && is_numeric($p['importo'] ?? null) ? ['id' => preg_replace('/[^\w-]/', '', (string)($p['id'] ?? bin2hex(random_bytes(4)))), 'data' => $p['data'], 'importo' => round((float)$p['importo'], 2), 'metodo' => mb_substr((string)($p['metodo'] ?? ''), 0, 30), 'nota' => mb_substr((string)($p['nota'] ?? ''), 0, 200)] : null, $o['pagamenti'])));
        if (empty($o['id']) || !preg_match('/^[a-z]-[a-z0-9-]{3,60}$/', (string)$o['id'])) $o['id'] = new_id(substr($coll, 0, 1) . '-');
        $old = get_item($coll, $o['id']);
        if ($old && isset($old['docs'])) $o['docs'] = $old['docs'];
        if ($coll === 'bookings') {
            if (!is_date($o['dal'] ?? '') || !is_date($o['al'] ?? '') || $o['al'] < $o['dal']) fail('Date non valide');
            $sr = shop_range(get_item('vehicles', (string)$o['vehicleId']));
            if (in_array($o['stato'] ?? '', ACTIVE, true) && $sr && $sr[0] <= $o['al'] && $sr[1] >= $o['dal']) fail('Il mezzo è dal meccanico in queste date');
            if (in_array($o['stato'] ?? '', ACTIVE, true) && !is_free((string)$o['vehicleId'], $o['dal'], $o['al'], $o['id'])) fail('Il mezzo è già occupato in queste date');
        }
        if (in_array($coll, ['clients', 'bookings'], true) && (!empty($o['cognome']) || !empty($o['nome']))) $o['cognomeNome'] = trim(($o['cognome'] ?? '') . ' ' . ($o['nome'] ?? ''));
        if ($coll === 'clients') {
            $nc = norm_cell((string)($o['cell'] ?? ''));
            if (strlen($nc) < 8) fail('Inserisci il cellulare del cliente');
            foreach (all_items('clients') as $x) if ($x['id'] !== $o['id'] && norm_cell((string)($x['cell'] ?? '')) === $nc) fail('Esiste già un cliente con questo cellulare: ' . ($x['cognomeNome'] ?? ''));
            $np = (string)($o['newPassword'] ?? '');
            if ($np !== '') { if (mb_strlen($np) < 6) fail('La password deve avere almeno 6 caratteri'); $o['pwhash'] = password_hash($np, PASSWORD_DEFAULT); }
            elseif ($old && !empty($old['pwhash'])) $o['pwhash'] = $old['pwhash'];
            else unset($o['pwhash']);
            unset($o['newPassword'], $o['hasPassword'], $o['codice'], $o['pin']);
        }
        if ($coll === 'clients' && !empty($o['docsFrom'])) { $src = get_item('bookings', (string)$o['docsFrom']); if ($src && isset($src['docs'])) $o['docs'] = $src['docs']; }
        unset($o['docsFrom']);
        put_item($coll, $o);
        $saved = get_item($coll, $o['id']);
        out(['ok' => true, 'obj' => $coll === 'clients' ? client_out($saved) : $saved]);
    }
    case 'admin_delete': {
        require_admin();
        $coll = in('coll'); $id = (string)in('id');
        if (!in_array($coll, ['vehicles', 'bookings', 'clients', 'crediti'], true)) fail('Dati non validi');
        $old = get_item($coll, $id);
        del_item($coll, $id);
        if ($old && !empty($old['docs'])) { $fs = []; foreach ($old['docs'] as $list) foreach ((array)$list as $d) $fs[] = $d['f'] ?? ''; cleanup_docs($fs); }
        out(['ok' => true]);
    }
    case 'admin_docs': {
        require_admin();
        $coll = in('coll'); $id = (string)in('id'); $kind = in('kind');
        if (!in_array($coll, ['bookings', 'clients'], true) || !in_array($kind, ['ci', 'pat'], true)) fail('Dati non validi');
        $o = get_item($coll, $id);
        if (!$o) fail('Salva prima il noleggio o il cliente');
        $docs = $o['docs'] ?? []; $docs += ['ci' => [], 'pat' => []];
        $added = 0;
        foreach (files_of('files') as $f) { $s = save_upload($f, DOC_TYPES, data_dir() . '/docs'); if ($s) { $docs[$kind][] = $s; $added++; } }
        if (!$added) fail('File non valido (foto JPG/PNG o PDF, max 12 MB)');
        $o['docs'] = $docs; put_item($coll, $o);
        // also keep a copy on the linked client, if it has none of this kind
        if ($coll === 'bookings' && !empty($o['clienteId']) && ($cl = get_item('clients', $o['clienteId'])) && empty($cl['docs'][$kind])) {
            $cd = $cl['docs'] ?? []; $cd += ['ci' => [], 'pat' => []]; $cd[$kind] = $docs[$kind]; $cl['docs'] = $cd; put_item('clients', $cl);
        }
        out(['ok' => true, 'docs' => $docs]);
    }
    case 'admin_doc_delete': {
        require_admin();
        $coll = in('coll'); $id = (string)in('id'); $kind = in('kind'); $f = (string)in('f');
        if (!in_array($coll, ['bookings', 'clients'], true) || !in_array($kind, ['ci', 'pat'], true)) fail('Dati non validi');
        $o = get_item($coll, $id);
        if (!$o) fail('Non trovato', 404);
        $o['docs'][$kind] = array_values(array_filter($o['docs'][$kind] ?? [], fn($d) => ($d['f'] ?? '') !== $f));
        put_item($coll, $o); cleanup_docs([$f]);
        out(['ok' => true, 'docs' => $o['docs']]);
    }
    case 'admin_photo': {
        require_admin();
        $dir = __DIR__ . '/img/mezzi';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        $s = save_upload($_FILES['foto'] ?? [], ['image/jpeg' => '.jpg', 'image/png' => '.png', 'image/webp' => '.webp'], $dir, 15);
        if (!$s) fail('Foto non valida (JPG, PNG o WEBP, max 15 MB)');
        @chmod($dir . '/' . $s['f'], 0644);
        out(['ok' => true, 'url' => 'img/mezzi/' . $s['f']]);
    }
    case 'admin_settings': {
        require_admin();
        $s = settings(); $wa = [];
        foreach ((body()['wa'] ?? []) as $w) {
            $ph = preg_replace('/[^\d+]/', '', (string)($w['phone'] ?? '')); $k = preg_replace('/[^\w-]/', '', (string)($w['apikey'] ?? ''));
            if ($ph !== '') $wa[] = ['phone' => $ph, 'apikey' => $k];
        }
        $s['wa'] = $wa; put_item('settings', $s); out(['ok' => true]);
    }
    case 'admin_km': {
        require_admin();
        $s = settings();
        $s['kmInclusi'] = max(1, (int)in('inclusi', 100)); $s['costoKm'] = max(0, round((float)in('costo', 0.2), 2)); $s['supplIllimitati'] = max(0, round((float)in('suppl', 0), 2));
        put_item('settings', $s); out(['ok' => true, 'km' => km_cfg()]);
    }
    case 'admin_check': { require_admin(); out(['ok' => true] + expiry_check(true)); }
    case 'admin_test': {
        require_admin();
        $r = notify(['dal' => date('Y-m-d'), 'al' => date('Y-m-d', time() + 86400), 'oraInizio' => '09:00', 'cognomeNome' => 'PROVA avvisi', 'cell' => '000', 'email' => '', 'prezzo' => 0], ['marca' => 'Messaggio', 'modello' => 'di prova', 'targa' => '']);
        out(['ok' => true] + $r);
    }
    case 'admin_password': {
        require_admin();
        $s = settings();
        if (!password_verify((string)in('old'), $s['pwhash'])) { sleep(1); fail('Password attuale errata'); }
        if (mb_strlen((string)in('new')) < 8) fail('La nuova password deve avere almeno 8 caratteri');
        $s['pwhash'] = password_hash((string)in('new'), PASSWORD_DEFAULT); $s['tokens'] = []; put_item('settings', $s); remember_set(); out(['ok' => true]);
    }
    case 'admin_backup': {
        if (!is_admin()) fail('Accesso richiesto', 401);
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="magirent-backup-' . date('Y-m-d') . '.json"');
        echo json_encode(['vehicles' => all_items('vehicles'), 'bookings' => all_items('bookings'), 'clients' => array_map('client_out', all_items('clients')), 'crediti' => all_items('crediti'), 'data' => date('c')], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }
    default: fail('Azione sconosciuta', 404);
    }
} catch (Throwable $e) {
    error_log('magirent: ' . $e->getMessage());
    fail('Errore del server. Riprova tra poco.', 500);
}
