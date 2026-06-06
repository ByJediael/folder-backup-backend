#!/usr/bin/env bash
# Remove registro FCM de um celular (mesmo efeito do botão Remover na central).
# Uso: BACKUP_API_TOKEN=12345678 ./scripts/unregister-device.sh mi9-se
set -euo pipefail

DEVICE_ID="${1:?Informe device_id (ex: mi9-se)}"
BASE_URL="${BACKUP_API_BASE:-https://backup.jediael.uk/api/v1}"
TOKEN="${BACKUP_API_TOKEN:?Defina BACKUP_API_TOKEN}"

curl -sS -X DELETE \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/admin/devices/${DEVICE_ID}" | jq .
