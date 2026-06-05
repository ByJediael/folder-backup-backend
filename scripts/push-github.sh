#!/usr/bin/env bash
# Repo sugerido: folder-backup-backend (ou renomeie no GitHub)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_NAME="${REPO_NAME:-folder-backup-backend}"
VISIBILITY="${VISIBILITY:-private}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Instale: sudo apt install gh && gh auth login"
  exit 1
fi

gh repo create "${REPO_NAME}" --"${VISIBILITY}" --source=. --remote=origin \
  --description="Backend API + FCM + Evolution + central WhatsApp (6 slots)" --push
echo "OK: https://github.com/$(gh api user -q .login 2>/dev/null || echo USER)/${REPO_NAME}"
