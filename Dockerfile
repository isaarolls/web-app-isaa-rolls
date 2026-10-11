# Isa Manager – immagine di produzione (backend + interfaccia compilata)

# 1) compilazione dell'interfaccia web
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --omit=optional --no-audit --no-fund react react-dom react-icons esbuild
COPY web/ ./
RUN node build.mjs

# 2) server Python
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production WEB_DIST=/app/web/dist
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ ./
COPY --from=web /web/dist /app/web/dist
RUN useradd -m isa && chown -R isa /app
USER isa
EXPOSE 8000
# Le migrazioni del database vengono applicate automaticamente all'avvio (AUTO_MIGRATE=1)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-1}"]
