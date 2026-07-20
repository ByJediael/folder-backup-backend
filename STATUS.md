# Folder Backup Backend — status

Última atualização: 2026-07-20

> Progresso do produto (pool + link de leads): ver **[`ROADMAP.md`](ROADMAP.md)**.

## Link de leads (novo)

Com números `pool_status=online` + `phone_e164` no slot:

```text
{PUBLIC_BASE_URL}/r/default
```

Redirect 302 → `https://wa.me/<numero>`. Admin: `GET /api/v1/admin/pool`, `GET /api/v1/admin/metrics`.

## Automação com FCM (sem Sincronizar manual)

Com Firebase configurado (`firebase/README.md`):

1. **n8n** → `POST /api/v1/admin/jobs`
2. **Backend** → push FCM `action=sync` + webhook `job_created`
3. **Celular** → sync automático → upload
4. **Backend** → webhooks `file_uploaded`, `job_progress`

```
n8n --POST admin/jobs--> Backend --FCM--> Celular
         |                    |
         +----webhook n8n-----+----GET/upload----> data/uploads/
```

Sem FCM: job fica `pending` até **Sincronizar** ou poll ~15 min.

## Disparar backup pelo n8n

| Workflow | Uso |
|----------|-----|
| `create-backup-job.json` | Download / pasta genérica (VPS) |
| `create-backup-job-local.json` | Mesma LAN |
| `create-backup-job-whatsapp-w4b.json` | WhatsApp Business `/data/data/com.whatsapp.w4b` (root) |

Header: `Authorization: Bearer 12345678`

Registro push: abra o app e **Salvar** API (grava token em `data/fcm-tokens.json`).

## Firebase

Ver [`firebase/README.md`](firebase/README.md) · teste: `./scripts/test-fcm.sh mi9-se`

## Fluxo Download (rápido)

```bash
./scripts/backup-download.sh mi9-se /sdcard/Download
```

## Config

- API: `http://192.168.1.9:8080`
- Token: `12345678`
- Device: `mi9-se`

## Subir o servidor

```bash
export PATH="$HOME/.local/node-v20/bin:$PATH"
cd ~/Documentos/folder-backup-backend
fuser -k 8080/tcp 2>/dev/null; npm start
```

## n8n — receber eventos

Webhook no `.env` (`N8N_WEBHOOK_URL`) — workflow **Active**.

Teste: `curl -X POST -H "Authorization: Bearer 12345678" http://127.0.0.1:8080/api/v1/admin/n8n/test`

## Não fazer

- `curl .../devices/mi9-se/commands` no PC (consome job sem upload)

## Fora de casa

[`deploy/README.md`](deploy/README.md) · [`n8n/README.md`](n8n/README.md)
