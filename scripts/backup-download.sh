#!/usr/bin/env bash
# Dispara backup de /sdcard/Download no celular mi9-se (mesma Wi-Fi).
# Depois: no app Folder Backup Agent → Sincronizar agora.
set -euo pipefail

export PATH="${HOME}/.local/node-v20/bin:${PATH:-}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-12345678}"
DEVICE_ID="${1:-mi9-se}"
ABS_PATH="${2:-/sdcard/Download}"

echo "Criando job BACKUP → device=$DEVICE_ID path=$ABS_PATH"
curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"type\":\"BACKUP\",\"absolute_path\":\"${ABS_PATH}\"}" \
  "${BASE_URL}/api/v1/admin/jobs" | python3 -m json.tool 2>/dev/null || cat

echo ""
echo "Com FCM: o celular sincroniza sozinho. Sem FCM: Sincronizar agora no app."
echo "Arquivos salvos em: $(cd "$(dirname "$0")/.." && pwd)/data/uploads/"
echo "Eventos n8n: job_created, file_uploaded, job_progress"
