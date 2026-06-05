#!/usr/bin/env bash
# Testa registro FCM e criação de job (push só se FIREBASE_SERVICE_ACCOUNT_PATH estiver no .env)
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-dev-token-change-me}"
DEVICE_ID="${1:-mi9-se}"
FAKE_TOKEN="${2:-fake-fcm-token-for-smoke-test}"

echo "== health (fcm status) =="
if command -v jq >/dev/null 2>&1; then
  curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/v1/health" | jq '.fcm'
else
  curl -sS -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/api/v1/health"
fi

echo ""
echo "== PUT fcm-token =="
curl -sS -X PUT \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"fcm_token\":\"${FAKE_TOKEN}\"}" \
  "${BASE_URL}/api/v1/devices/${DEVICE_ID}/fcm-token"
echo ""

echo ""
echo "== POST job (dispara FCM se configurado) =="
curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"type\":\"BACKUP\",\"absolute_path\":\"/sdcard/Download\"}" \
  "${BASE_URL}/api/v1/admin/jobs"
echo ""

echo ""
echo "Verifique logs do backend (fcm: sync push enviado) e data/fcm-tokens.json"
