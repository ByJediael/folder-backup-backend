#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"
CODE="${CODE:?CODE obrigatório}"
REQUEST_ID="${REQUEST_ID:?REQUEST_ID obrigatório}"

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"$DEVICE_ID\",\"request_id\":\"$REQUEST_ID\",\"code\":\"$CODE\"}" \
  "${BASE_URL}/api/v1/admin/whatsapp/register-code"
echo
