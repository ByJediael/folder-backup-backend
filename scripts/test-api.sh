#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-dev-token-change-me}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"
AUTH="Authorization: Bearer ${TOKEN}"

echo "== Health =="
curl -sS -H "$AUTH" "${BASE_URL}/api/v1/health" | jq .

echo ""
echo "== Teste webhook n8n =="
curl -sS -X POST -H "$AUTH" "${BASE_URL}/api/v1/admin/n8n/test" | jq .

echo ""
echo "== Criar job BACKUP =="
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"type\":\"BACKUP\",\"absolute_path\":\"/sdcard/Download\"}" \
  "${BASE_URL}/api/v1/admin/jobs" | jq .

echo ""
echo "== Commands (celular buscaria isto) =="
curl -sS -H "$AUTH" "${BASE_URL}/api/v1/devices/${DEVICE_ID}/commands" | jq .
