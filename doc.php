<?php
/* Mostra un documento del cliente (solo per il gestionale) */
declare(strict_types=1);
require __DIR__ . '/config.php';
session_name('magisess');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'httponly' => true, 'samesite' => 'Lax']);
session_start();
if (empty($_SESSION['admin'])) { http_response_code(401); exit('Accesso riservato'); }
$f = (string)($_GET['f'] ?? '');
if (!preg_match('/^[a-f0-9]{32}\.bin$/', $f)) { http_response_code(404); exit('Non trovato'); }
$dirs = [dirname(__DIR__) . '/magirent_private/docs', __DIR__ . '/data/docs'];
foreach ($dirs as $d) {
    $p = $d . '/' . $f;
    if (is_file($p)) {
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($p) ?: 'application/octet-stream';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($p));
        header('Content-Disposition: inline; filename="documento' . ($mime === 'application/pdf' ? '.pdf' : '.jpg') . '"');
        header('Cache-Control: private, no-store');
        header('X-Content-Type-Options: nosniff');
        readfile($p);
        exit;
    }
}
http_response_code(404); echo 'Non trovato';
