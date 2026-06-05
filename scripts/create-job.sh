#!/usr/bin/env bash
# Uso local: criar job para o celular buscar na próxima sincronização
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
TOKEN="${BACKUP_API_TOKEN:-dev-token-change-me}"
DEVICE_ID="${1:-mi9-se}"
ABS_PATH="${2:-/sdcard/Download}"

curl -sS -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"device_id\":\"${DEVICE_ID}\",\"type\":\"BACKUP\",\"absolute_path\":\"${ABS_PATH}\"}" \
  "${BASE_URL}/api/v1/admin/jobs"
echo ""
