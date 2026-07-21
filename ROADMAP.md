# ROADMAP — pool de WhatsApp + link de leads

**Última atualização:** 2026-07-21  
**Fase atual:** pairing automático (fila sem FCM) — reteste no celular  
**Próximo passo:** testar fluxo completo link-evolution → nav → código fresco → digitar  
**Bloqueio anterior:** código pedia cedo demais (expirava/inválido); corrigido — Evolution só após nav OK

---

## Sessão 2026-07-20 (resumo)

### Entregue
- Link de leads `GET /r/:campaign` → rodízio → `wa.me` + hits JSONL
- Pool `online/offline/remounting` + health Evolution
- Remonta (HeroSMS) + fila com lock por `device_id` + buffer
- `POST /api/v1/admin/whatsapp/link-evolution` + fila `device-actions` (funciona sem FCM)
- APK: flavors `local`/`prod`, Device ID automático, poll de comandos 8s, textos ES no pairing
- Docs: `ROADMAP.md`, `AMBIENTES.md`, `PAIRING-AUTO.md`, `TESTE-USB-G570M.md`

### Teste físico (SM-G570M)
- Backend local + `adb reverse` + Evolution `https://evolution.jediael.uk`
- Instância `wa-co-3159397209` / número `+573159397209`
- Comandos chegam no APK; falha atual: UI não abre os campos do código (`nenhum campo`)
- Reinstall do APK desliga acessibilidade (comportamento Android)

### Não commitado (secrets / local)
- `.env` (token Evolution, etc.)
- `local.properties` do APK
- `data/` runtime

---

## Checklist 2 minutos (casa ou serviço)

1. `git pull` em `folder-backup-backend` e `apk_back`
2. Evolution no ar? (`EVOLUTION_BASE_URL` + `EVOLUTION_API_KEY`)
3. Backend no ar? (`npm start` → `/health`)
4. Algum celular com FCM registrado? (`GET /api/v1/admin/devices`)
5. Pool: quantos `online`? (`GET /api/v1/admin/pool` ou `/api/v1/admin/metrics`)

Ao sair: atualizar **Fase atual / Próximo passo / Bloqueio** neste arquivo + `git commit` + `git push`.

---

## Mapa das pastas

| Pasta | Papel | Mexer? |
|-------|--------|--------|
| `C:\Github\apk` | Lab root/arquivos | Não |
| `C:\Github\apk_back` | APK agente (cadastro, FCM, pairing) | Sim — remonta |
| `C:\Github\folder-backup-backend` | API + Evolution + **link `/r/:campaign`** | Sim — fonte da verdade |
| `apk_back/server/backup-api` | Stub antigo | Não usar |

---

## Fases

- [x] **0 — Organização** — este `ROADMAP.md` + env vars documentadas
- [x] **1 — Link roteador** — `GET /r/:campaign` → rodízio → 302 `wa.me` + hits JSONL
- [x] **2 — Pool e saúde** — `pool_status` online/offline/remounting + health check
- [x] **3 — Remonta** — fila HeroSMS + FCM register/pairing (1 job por `device_id`)
- [x] **4 — Escala** — locks por device, buffer `POOL_ONLINE_BUFFER`, métricas

---

## Env vars (sem secrets no git)

| Variável | Uso |
|----------|-----|
| `BACKUP_API_TOKEN` | Auth admin / APK |
| `PUBLIC_BASE_URL` | URL pública do backend (link de campanha) |
| `EVOLUTION_BASE_URL` / `EVOLUTION_API_KEY` | Proxy Evolution |
| `HERO_SMS_API_KEY` | Remonta automática |
| `HERO_SMS_SERVICE` | default `wa` |
| `HERO_SMS_COUNTRY` | default `73` |
| `POOL_HEALTH_INTERVAL_MS` | default `60000` |
| `REMOUNT_INTERVAL_MS` | default `30000` |
| `POOL_ONLINE_BUFFER` | meta de slots online (default `20`) |
| `REMOUNT_AUTO_ENQUEUE` | `true` para enfileirar quando abaixo do buffer |

Link de campanha (exemplo): `{PUBLIC_BASE_URL}/r/default`

---

## Endpoints novos (resumo)

| Método | Path | Auth | Função |
|--------|------|------|--------|
| GET | `/r/:campaign` | não | Redirect lead → `wa.me` |
| GET | `/api/v1/admin/pool` | sim | Lista slots do pool |
| POST | `/api/v1/admin/pool/health` | sim | Sync Evolution → pool |
| POST | `/api/v1/admin/pool/:slotId/offline` | sim | Tira do rodízio |
| POST | `/api/v1/admin/pool/:slotId/online` | sim | Força elegível (se tiver telefone) |
| GET | `/api/v1/admin/remount/queue` | sim | Fila de remonta |
| POST | `/api/v1/admin/remount` | sim | Enfileira slot / offline |
| POST | `/api/v1/admin/remount/process` | sim | Processa 1 tick |
| GET | `/api/v1/admin/metrics` | sim | Hits, online, buffer, bans |

---

## Como retomar

1. `git pull` nos repos  
2. Ler **Fase atual** e **Próximo passo** acima  
3. Checklist  
4. Trabalhar só na fase marcada; ao sair atualizar este arquivo + push  
