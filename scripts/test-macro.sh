#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"
AUTH="Authorization: Bearer ${TOKEN}"
echo "== Health =="
curl -sS -H "$AUTH" "${BASE_URL}/api/v1/health" | jq .
echo ""
echo "== macro/home =="
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\"}" \
  "${BASE_URL}/api/v1/admin/whatsapp/macro/home" | jq .
sleep 2
echo ""
echo "== macro/open-whatsapp =="
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\"}" \
  "${BASE_URL}/api/v1/admin/whatsapp/macro/open-whatsapp" | jq .
