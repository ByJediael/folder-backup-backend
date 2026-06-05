# Workflows n8n

Fluxo com FCM: **n8n → backend (HTTP) → FCM → APK no celular** · eventos: **backend → n8n (webhook)**.

## Começar agora (VPS — backup.jediael.uk)

### Passo 1 — Eventos do backend → n8n

1. n8n → **Workflows** → **Import from File** → `on-backup-event.json`
2. Abra o workflow → nó **Webhook backup-events** → copie a **Production URL**  
   Ex.: `https://n8n.jediael.uk/webhook/backup-events`
3. EasyPanel → **back_apk** → **Ambiente**:

```env
N8N_WEBHOOK_URL=https://n8n.jediael.uk/webhook/backup-events
```

4. **Ative** o workflow no n8n (toggle verde) e **Implantar** o backend.
5. Teste:

```bash
curl -skS -X POST -H "Authorization: Bearer 12345678" \
  https://backup.jediael.uk/api/v1/admin/n8n/test
```

No n8n deve aparecer uma execução com evento `test`.

### Passo 2 — Primeiro comando no celular via n8n

1. Importe `wa-clear-session.json` (ou `wa-macro-open-whatsapp.json` para teste visual).
2. No nó **Variáveis**, confira:

| Campo | Valor |
|--------|--------|
| `backend_base` | `https://backup.jediael.uk` |
| `backend_token` | mesmo `BACKUP_API_TOKEN` do backend |
| `device_id` | `mi9-se` |

3. **Execute workflow** (manual) → celular deve limpar WA / ir para HOME+WA.
4. Celular: tela desbloqueada, **acessibilidade** do app ativa.

### Passo 3 — Fluxos maiores

| Ordem sugerida | Arquivo |
|----------------|---------|
| Restaurar sessão | `switch-whatsapp-session.json` |
| Macro launcher | `wa-macro-open-whatsapp.json` |
| Cadastro + Hero SMS | `wa-register-hero-sms.json` |
| Montagem completa | `wa-montagem-factory.json` |
| Evolution caiu | `evo-disconnected-multi-device.json` |
| Backup de pasta | `create-backup-job.json` |

Todos os nós HTTP usam: `{{ $json.backend_base }}/api/v1/...` + `Bearer {{ $json.backend_token }}`.

| Arquivo | Uso |
|---------|-----|
| `on-backup-event.json` | **Recebe** eventos do backend (`test`, `job_created`, …) → Production URL no `.env` |
| `create-backup-job.json` | **Cria** job: `POST https://n8n.jediael.uk/webhook/api/v1/admin/jobs` (VPS + nginx) |
| `create-backup-job-local.json` | **Cria** job: `POST http://192.168.1.9:8080/api/v1/admin/jobs` (só na mesma LAN) |
| `create-backup-job-whatsapp-w4b.json` | WhatsApp Business dados (`/data/data/com.whatsapp.w4b`, root) |
| `wa-register-hero-sms.json` | Hero SMS getNumber → clear → register → código → status |
| `wa-clear-session.json` | Limpar sessão WA no celular (igual botão Limpar na central) |
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
