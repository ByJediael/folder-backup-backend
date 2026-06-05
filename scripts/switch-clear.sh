#!/usr/bin/env bash
# Limpa sessão WA no celular via FCM (mesmo efeito do botão no app)
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\"}" \
  "${BASE_URL}/api/v1/admin/whatsapp/clear"
echo
