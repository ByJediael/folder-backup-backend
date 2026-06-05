# Deploy no EasyPanel (VPS + n8n)

Objetivo: backend **sempre na VPS**, fácil de atualizar, n8n e celular (4G) na mesma URL pública.

## Arquitetura recomendada

```text
                    Internet
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
  backup.jediael.uk   n8n.jediael.uk   Celular 4G
  (app EasyPanel)     (já no EasyPanel)  APK → backup.../webhook
         │              │
         │              └── workflows HTTP → backup (ver abaixo)
         └── folder-backup-backend :8080
```

**Use um subdomínio só para o backend** (ex. `backup.jediael.uk`).  
Evita brigar com o n8n na raiz do `n8n.jediael.uk`.

| Quem | URL base |
|------|----------|
| APK (4G) | `https://backup.jediael.uk` |
| n8n HTTP Request | `https://backup.jediael.uk/api/v1/...` |
| Central web | `https://backup.jediael.uk/` |
| Montagem | `https://backup.jediael.uk/mount` |

Se quiser manter tudo em `n8n.jediael.uk/webhook/...`, configure **proxy path** no EasyPanel/Traefik (seção opcional no fim).

---

## 1. Primeira instalação no EasyPanel

### 1.1 Enviar o código para a VPS

Escolha uma opção:

**A) Git (recomendado para atualizar)**

1. Suba `folder-backup-backend` para GitHub/GitLab (sem `.env` nem `firebase/serviceAccount.json`).
2. No EasyPanel: **Create Service** → **App** → conecte o repositório.
3. Branch: `main` · Build: **Dockerfile** · Dockerfile path: `/Dockerfile`.

**B) SFTP / rsync**

```bash
rsync -avz --exclude node_modules --exclude data --exclude .env \
  ./folder-backup-backend/ user@VPS:/opt/folder-backup-backend/
```

No EasyPanel: app tipo **Docker Compose** apontando para `docker-compose.prod.yml` na pasta.

### 1.2 Variáveis de ambiente

No painel do app, cole de [`easypanel.env.example`](easypanel.env.example):

- `BACKUP_API_TOKEN` — forte; mesmo valor no APK e n8n
- `PUBLIC_BASE_URL=https://backup.jediael.uk` (seu domínio real)
- `FCM_ENABLED=true`
- `FIREBASE_SERVICE_ACCOUNT_PATH=/app/firebase/serviceAccount.json`
- `N8N_WEBHOOK_URL` — URL de produção do workflow `on-backup-event` no n8n

### 1.3 Firebase (FCM)

1. No servidor, crie a pasta e envie o JSON (nunca no Git):

```bash
mkdir -p /opt/folder-backup-backend/firebase
nano /opt/folder-backup-backend/firebase/serviceAccount.json
```

2. No EasyPanel, **Volume** ou **Mount**:

| Host | Container |
|------|-----------|
| `/opt/folder-backup-backend/firebase/serviceAccount.json` | `/app/firebase/serviceAccount.json` |

3. Pasta de dados persistente:

| Host | Container |
|------|-----------|
| `/opt/folder-backup-backend/data` | `/app/data` |

### 1.4 Domínio e porta

- **Container port:** `8080`
- **Domain:** `backup.jediael.uk` (SSL Let's Encrypt no EasyPanel)
- Publicar só **127.0.0.1:8080** no host se o proxy do EasyPanel já encaminha (compose já faz isso).

### 1.5 Deploy

Build & Start no EasyPanel. Teste:

```bash
curl -sS -H "Authorization: Bearer SEU_TOKEN" \
  https://backup.jediael.uk/api/v1/health | jq .
```

---

## 2. Ligar o n8n (já no EasyPanel)

O n8n **não precisa** estar no mesmo container; só precisa **alcançar** o backend.

### Workflows — URL nos nós HTTP

No nó **Set** (Variáveis):

```text
backend_base = https://backup.jediael.uk
backend_token = SEU_BACKUP_API_TOKEN
device_id = mi9-se
```

URLs dos nós:

```text
{{ $json.backend_base }}/api/v1/admin/whatsapp/macro/home
```

Header em **todos** os HTTP Request:

```text
Authorization: Bearer {{ $json.backend_token }}
```

### n8n na mesma VPS (rede interna, opcional)

Se o EasyPanel colocar os dois na mesma rede Docker, você pode usar URL **interna** (mais rápido, sem sair à internet):

```text
http://folder-backup-backend:8080/api/v1/...
```

O nome do host é o **nome do serviço** no EasyPanel (veja em App → Networking).  
O APK e o 4G **continuam** usando a URL pública `https://backup.jediael.uk`.

### Importar workflows

1. n8n → **Workflows** → Import from File  
2. Arquivos em `n8n/workflows/` deste repo  
3. Ajuste `backend_base` / `backend_token` / `device_id`  
4. **Activate**

| Workflow | Uso |
|----------|-----|
| `wa-macro-open-whatsapp.json` | Teste macro HOME + abrir WA |
| `wa-montagem-factory.json` | Montagem completa + Hero SMS |
| `on-backup-event.json` | Eventos do backend → n8n |

`N8N_WEBHOOK_URL` no `.env` do backend = URL de produção do trigger do `on-backup-event`.

---

## 3. Atualizar versão (dia a dia)

### Com Git na VPS

```bash
ssh user@VPS
cd /opt/folder-backup-backend
export BACKUP_API_TOKEN=seu-token   # só para o health no script
./scripts/vps-update.sh
```

Ou no EasyPanel: **Redeploy** / **Rebuild** após push no Git (se CI ligado).

### Sem Git

```bash
rsync -avz --exclude node_modules --exclude data --exclude .env \
  ./folder-backup-backend/ user@VPS:/opt/folder-backup-backend/
ssh user@VPS 'cd /opt/folder-backup-backend && docker compose -f docker-compose.prod.yml up -d --build'
```

**Dados preservados:** pasta `data/` e `firebase/serviceAccount.json` ficam no volume — atualizar imagem **não apaga** slots, FCM tokens nem eventos.

### APK (celular)

```bash
# No PC
cd folder-backup-agent
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

No app: URL `https://backup.jediael.uk`, token, device_id → **Salvar**.

---

## 4. Checklist pós-deploy

- [ ] `GET /api/v1/health` → `fcm.enabled: true`
- [ ] APK Salvar → `fcm.registered_devices` inclui `mi9-se`
- [ ] `POST .../macro/home` → `fcm_ok: true`
- [ ] Central abre em `https://backup.jediael.uk/`
- [ ] Workflow n8n teste manual executa sem 401/502

---

## 5. Opcional: mesmo domínio do n8n (`/webhook/api`)

Se **não** quiser subdomínio `backup.`, no proxy do EasyPanel (Traefik/Caddy) na app do n8n ou proxy global:

```nginx
location /webhook/api/ {
    proxy_pass http://127.0.0.1:8080/api/;
}
```

Então:

- APK URL base: `https://n8n.jediael.uk/webhook`
- n8n: `https://n8n.jediael.uk/webhook/api/v1/...`

Conflito comum: n8n já usa `/` — por isso o subdomínio `backup.` é mais simples no EasyPanel.

---

## 6. Evolution na mesma VPS

Se Evolution roda no EasyPanel com hostname interno `evolution-api`:

```env
EVOLUTION_BASE_URL=http://evolution-api:8080
```

Webhook Evolution → `https://backup.jediael.uk/api/v1/webhooks/evolution`

---

## Resumo

| Pergunta | Resposta |
|----------|----------|
| Backend local ainda? | Não em produção — só na VPS |
| n8n chama como? | HTTP Request → `https://backup.jediael.uk/api/v1/...` |
| Atualizar backend? | `git pull` + `./scripts/vps-update.sh` ou Redeploy EasyPanel |
| Atualizar APK? | Build + `adb install` separado |
