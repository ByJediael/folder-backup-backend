#!/usr/bin/env bash
# Dispara cadastro WA no celular (n8n chama após Hero SMS getNumber)
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${DEVICE_ID:-mi9-se}"
PHONE="${PHONE_E164:?PHONE_E164 obrigatório}"
LABEL="${SESSION_LABEL:-numero-hero-1}"
REQUEST_ID="${REQUEST_ID:-reg-$(date +%s)}"
DISPLAY_NAME="${DISPLAY_NAME:-}"

BODY=$(cat <<EOF
{
  "device_id": "$DEVICE_ID",
  "request_id": "$REQUEST_ID",
  "phone_e164": "$PHONE",
  "session_label": "$LABEL",
  "display_name": "$DISPLAY_NAME"
}
EOF
)

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "${BASE_URL}/api/v1/admin/whatsapp/register"
echo
