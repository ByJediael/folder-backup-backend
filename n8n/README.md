# Workflows n8n

Fluxo com FCM: **n8n → backend (criar job + push) → app sincroniza sozinho → webhooks de evento**.

| Arquivo | Uso |
|---------|-----|
| `on-backup-event.json` | **Recebe** eventos do backend (`test`, `job_created`, …) → Production URL no `.env` |
| `create-backup-job.json` | **Cria** job: `POST https://n8n.jediael.uk/webhook/api/v1/admin/jobs` (VPS + nginx) |
| `create-backup-job-local.json` | **Cria** job: `POST http://192.168.1.9:8080/api/v1/admin/jobs` (só na mesma LAN) |
| `create-backup-job-whatsapp-w4b.json` | WhatsApp Business dados (`/data/data/com.whatsapp.w4b`, root) |
| `wa-register-hero-sms.json` | Hero SMS getNumber → clear → register → código → status |
| `wa-macro-open-whatsapp.json` | Teste isolado: macro HOME → Wait 2s → abrir WA pelo launcher |
| `wa-montagem-factory.json` | Montagem E2E: Hero → clear → **macro HOME/open** → register → pair → export → clear |
| `evo-disconnected-multi-device.json` | `evo_disconnected` → clear + switch no `device_id` do slot (6 aparelhos) |

## Teste macro + montagem (checklist)

1. Celular fábrica: APK com URL/token/`device_id` salvos; **Acessibilidade** ligada; tela **desbloqueada**.
2. Backend: `FIREBASE_SERVICE_ACCOUNT_PATH` válido; `device_id` em `data/fcm-tokens.json`.
3. n8n: ajuste `backend_base`, `backend_token`, `device_id`, `hero_api_key` no nó **Variáveis**.
4. Teste rápido: importe `wa-macro-open-whatsapp.json` → Execute (Manual) → veja HOME e ícone WA no celular.
5. Montagem completa: `wa-montagem-factory.json` (Hero compra número + macro + cadastro + Evolution).

Endpoints macro:

- `POST /api/v1/admin/whatsapp/macro/home`
- `POST /api/v1/admin/whatsapp/macro/open-whatsapp`

Body: `{ "device_id": "factory-phone" }` — Header: `Authorization: Bearer <token>`.

Header: `Authorization: Bearer 12345678`

## URL do backend (VPS / EasyPanel)

| Onde | `backend_base` no nó Set |
|------|---------------------------|
| Subdomínio dedicado (recomendado) | `https://backup.jediael.uk` |
| Path no mesmo domínio do n8n | `https://n8n.jediael.uk/webhook` |

URLs dos nós HTTP: `{{ $json.backend_base }}/api/v1/admin/whatsapp/...`  
APK URL base = mesmo host do `backend_base` **sem** `/api` no final.

Pré-requisito FCM: app aberto uma vez com API salva; backend com `FIREBASE_SERVICE_ACCOUNT_PATH` — ver `../firebase/README.md`.  
Deploy: `../deploy/EASYPANEL.md`
