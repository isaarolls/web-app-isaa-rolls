"""Configurazione letta dalle variabili d'ambiente (nessun segreto nel codice)."""
import os

APP_ENV = os.environ.get("APP_ENV", "development")  # development | test | production
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://isa:isa_dev_pw@127.0.0.1:5432/isa_dev")
DB_POOL_SIZE = int(os.environ.get("DB_POOL_SIZE", "10"))

# URL pubblico dell'applicazione (usato nei link di recupero password)
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:8000").rstrip("/")

# Origini aggiuntive ammesse (CORS), es. app mobile Capacitor
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "capacitor://localhost,https://localhost,http://localhost"
    ).split(",")
    if o.strip()
]

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "14"))
SESSION_IDLE_HOURS = int(os.environ.get("SESSION_IDLE_HOURS", "72"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1" if APP_ENV in ("production", "staging") else "0") == "1"

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "10"))

# E-mail (facoltativo): se non configurato, l'amministratore genera il link di reset dall'app
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "")

WEB_DIST = os.environ.get(
    "WEB_DIST", os.path.join(os.path.dirname(__file__), "..", "..", "web", "dist")
)

IS_PROD = APP_ENV == "production"
