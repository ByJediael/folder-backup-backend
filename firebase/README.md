# Firebase (FCM) — push para acionar o backup no celular

## 1. Criar projeto

1. [Firebase Console](https://console.firebase.google.com/) → **Add project** (ex.: `folder-backup`).
2. **Add app** → Android → package name: `com.folderbackup.agent`.
3. Baixe **`google-services.json`** e coloque em:
   `folder-backup-agent/app/google-services.json`  
   (não commitar — já está no `.gitignore` do app.)

## 2. Service account (backend)

1. Project settings → **Service accounts** → **Generate new private key**.
2. Salve como `folder-backup-backend/firebase/serviceAccount.json` (fora do git).
3. No `.env` do backend:

```env
FCM_ENABLED=true
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase/serviceAccount.json
```

## 3. Verificar

```bash
# Backend rodando; app aberto e API salva no celular
curl -s -H "Authorization: Bearer SEU_TOKEN" http://127.0.0.1:8080/api/v1/health | jq .

# Deve listar mi9-se em fcm.registered_devices após abrir o app
cat data/fcm-tokens.json
```

## 4. Fluxo n8n

Workflow cria job → backend envia FCM `action=sync` → app faz upload sem tocar em **Sincronizar**.

Sem Firebase configurado, jobs continuam na fila e o poll de ~15 min ainda funciona.
