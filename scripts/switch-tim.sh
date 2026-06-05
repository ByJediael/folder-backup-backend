#!/usr/bin/env bash
# Troca WhatsApp → TIM v2 (celular precisa FCM + root + mesma Wi-Fi)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"session_label\":\"numero-timv2\",\"session_folder\":\"session_2026-05-22_22-08-54_numero-timv2\",\"open_whatsapp\":true}" \
  "${BASE_URL}/api/v1/admin/whatsapp/switch"
echo
