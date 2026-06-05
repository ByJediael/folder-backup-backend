#!/usr/bin/env bash
# Atualiza o backend na VPS após git pull (docker compose).
# Uso na VPS: cd ~/folder-backup-backend && ./scripts/vps-update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "== Pull =="
git pull --ff-only

echo "== Build e restart =="
docker compose -f "$COMPOSE_FILE" up -d --build

echo "== Health =="
sleep 3
curl -sf -H "Authorization: Bearer ${BACKUP_API_TOKEN:-}" "http://127.0.0.1:8080/api/v1/health" | head -c 500
echo ""
docker compose -f "$COMPOSE_FILE" ps
