#!/usr/bin/env bash
# Backup WhatsApp Business (dados internos) — requer root no celular + FCM registrado
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/create-job.sh" "${1:-mi9-se}" "/data/data/com.whatsapp.w4b"
