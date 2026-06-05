#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"

curl -sS -H "Authorization: Bearer ${TOKEN}" \
  "${BASE_URL}/api/v1/admin/whatsapp/status?device_id=${DEVICE_ID}"
echo
