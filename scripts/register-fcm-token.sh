#!/usr/bin/env bash
# Registra manualmente um token FCM no backend (quando o app não alcança a API).
# Uso: BACKUP_API_TOKEN=12345678 ./scripts/register-fcm-token.sh mi9-se 'APA91b...'
set -euo pipefail
DEVICE_ID="${1:?device_id}"
FCM_TOKEN="${2:?fcm_token}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"

curl -sS -X PUT \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"fcm_token\":\"${FCM_TOKEN}\"}" \
  "${BASE_URL}/api/v1/devices/${DEVICE_ID}/fcm-token" | jq .

echo "Teste macro:"
curl -sS -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\"}" \
  "${BASE_URL}/api/v1/admin/whatsapp/macro/home" | jq .
