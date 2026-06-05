#!/usr/bin/env bash
# Troca WhatsApp → Claro v2
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"session_label\":\"numero-clarov2\",\"session_folder\":\"session_2026-05-22_22-20-41_numero-clarov2\",\"open_whatsapp\":true}" \
  "${BASE_URL}/api/v1/admin/whatsapp/switch"
echo
