# Deploy backend (acesso fora da LAN)

Para o celular, a central web e o n8n na VPS alcançarem o backend fora da rede de casa.

**EasyPanel + n8n na mesma VPS:** guia passo a passo em **[EASYPANEL.md](EASYPANEL.md)** (subdomínio, volumes, atualizar com `scripts/vps-update.sh`).

## 1. Backend no servidor

```bash
cd folder-backup-backend
cp .env.example .env
# Edite BACKUP_API_TOKEN, N8N_WEBHOOK_URL, PUBLIC_BASE_URL
# FCM: FCM_ENABLED=true, FIREBASE_SERVICE_ACCOUNT_PATH=./firebase/serviceAccount.json
# Evolution (opcional): EVOLUTION_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET
docker compose up -d
# ou: npm start com Node 20+
```

## 2. Nginx no host do n8n

Use [`nginx-proxy.conf.example`](nginx-proxy.conf.example):

| URL pública | Destino |
|-------------|---------|
| `https://n8n.jediael.uk/` | Central (`control.html`, 6 slots) |
| `https://n8n.jediael.uk/switch` | Painel legado TIM/Claro |
| `https://n8n.jediael.uk/webhook/api/v1/...` | API Express |

Recarregue o nginx após colar os blocos `location`.

**Conflito com n8n na raiz:** se o n8n já usa `/`, publique a central em subdomínio (`backup.jediael.uk`) ou em `location /control/` apontando para `:8080`.

## 3. Seis celulares (APK)

Um backend, **seis `device_id` distintos**. Mesmo `BACKUP_API_TOKEN` em todos.

| Slot | `device_id` sugerido | Evolution (`evolution_instance`) |
|------|----------------------|----------------------------------|
| 1 | `phone-01` | `wa-01` |
| 2 | `phone-02` | `wa-02` |
| 3 | `phone-03` | `wa-03` |
| 4 | `phone-04` | `wa-04` |
| 5 | `phone-05` | `wa-05` |
| 6 | `mi9-se` (Mi 9 SE) | `wa-06` |

Por aparelho no APK:

- URL base: `https://n8n.jediael.uk/webhook` (sem `/api` no final)
- Token: mesmo `BACKUP_API_TOKEN` do `.env`
- **Device ID:** valor da coluna acima (único por celular)
- Salvar → entra em `data/fcm-tokens.json`

Ajuste rótulos e instâncias Evolution em `data/slots.json` ou via `PUT /api/v1/admin/slots/:slotId`.

Checklist por aparelho: autostart, bateria sem restrição, root/Magisk se usar backup de sessão, Acessibilidade para cadastro automático.

## 4. Central web

Abra `https://n8n.jediael.uk/` (ou `http://IP:8080/` na LAN).

- Informe o Bearer token na primeira visita
- Grade de 6 slots: status celular + Evolution, Limpar / Restaurar / Cadastrar / QR
- Timeline de eventos (`data/events.jsonl`)

## 5. Evolution API

No `.env` do backend:

```
EVOLUTION_ENABLED=true
EVOLUTION_BASE_URL=http://127.0.0.1:8081
EVOLUTION_API_KEY=sua-chave
EVOLUTION_WEBHOOK_SECRET=segredo-compartilhado
```

Na Evolution, webhook global ou por instância:

- URL: `https://n8n.jediael.uk/webhook/api/v1/webhooks/evolution`
- Header: `X-Evolution-Secret: <EVOLUTION_WEBHOOK_SECRET>`
- Eventos: `connection.update`

Desconexão → `evo_disconnected` no n8n → workflow [`evo-disconnected-multi-device.json`](../n8n/workflows/evo-disconnected-multi-device.json) limpa e restaura o `device_id` do slot.

## 6. n8n

| Workflow | Uso |
|----------|-----|
| `on-backup-event.json` | Recebe todos os eventos (`N8N_WEBHOOK_URL`) |
| `evo-disconnected-multi-device.json` | Evolution caiu → clear + switch no slot certo |
| `create-backup-job.json` | `POST .../webhook/api/v1/admin/jobs` |
| `wa-register-hero-sms.json` | Cadastro Hero SMS por `device_id` |

Header: `Authorization: Bearer SEU_TOKEN`

## 7. Fluxo resumido

1. Evolution desconecta instância `wa-03` → webhook → slot `phone-03` fica vermelho na central
2. n8n (opcional) → `clear` + `switch` só no `phone-03`
3. Operador na central pode clicar Limpar / Restaurar / QR manualmente
4. Backup de pasta: n8n cria job → FCM → APK sincroniza → `data/uploads/`
