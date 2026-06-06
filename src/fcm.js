const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const TOKENS_FILE = path.join(DATA_DIR, "fcm-tokens.json");

let messaging = null;
let initError = null;

function isEnabled() {
  const flag = process.env.FCM_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
}

function initFirebase() {
  if (messaging || initError) return;
  const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!accountPath) {
    initError = "FIREBASE_SERVICE_ACCOUNT_PATH não definido";
    return;
  }
  if (!fs.existsSync(accountPath)) {
    initError = `Service account não encontrado: ${accountPath}`;
    return;
  }
  try {
    const admin = require("firebase-admin");
    const serviceAccount = JSON.parse(fs.readFileSync(accountPath, "utf8"));
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    messaging = admin.messaging();
  } catch (err) {
    initError = err.message || String(err);
  }
}

function readTokens() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TOKENS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeTokens(map) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(map, null, 2), "utf8");
}

function saveFcmToken(deviceId, fcmToken) {
  const map = readTokens();
  map[deviceId] = {
    token: fcmToken,
    updated_at: new Date().toISOString(),
  };
  writeTokens(map);
}

function getFcmToken(deviceId) {
  const entry = readTokens()[deviceId];
  return entry?.token || null;
}

function deleteFcmToken(deviceId) {
  const map = readTokens();
  if (!map[deviceId]) return false;
  delete map[deviceId];
  writeTokens(map);
  return true;
}

async function sendDataPush(deviceId, data) {
  if (!isEnabled()) {
    return { ok: false, skipped: true, reason: "fcm_disabled" };
  }
  initFirebase();
  if (!messaging) {
    return { ok: false, error: initError || "firebase_not_initialized" };
  }
  const token = getFcmToken(deviceId);
  if (!token) {
    return { ok: false, skipped: true, reason: "no_token_for_device" };
  }
  try {
    const messageId = await messaging.send({
      token,
      data,
      android: {
        priority: "high",
        ttl: 30000,
      },
    });
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function sendSyncPush(deviceId) {
  return sendDataPush(deviceId, { action: "sync" });
}

async function sendSwitchSessionPush(deviceId, sessionLabel, requestId, openWhatsapp = true, sessionFolder = null) {
  const data = {
    action: "switch_session",
    session_label: sessionLabel,
    request_id: requestId,
    open_whatsapp: openWhatsapp ? "1" : "0",
  };
  if (sessionFolder) data.session_folder = sessionFolder;
  return sendDataPush(deviceId, data);
}

async function sendClearSessionPush(deviceId, requestId) {
  return sendDataPush(deviceId, {
    action: "clear_session",
    request_id: requestId,
  });
}

async function sendRegisterWhatsappPush(deviceId, requestId, phoneE164, sessionLabel, displayName) {
  const data = {
    action: "register_whatsapp",
    request_id: requestId,
    phone_e164: phoneE164,
    session_label: sessionLabel,
  };
  if (displayName) data.display_name = displayName;
  return sendDataPush(deviceId, data);
}

async function sendSubmitRegistrationCodePush(deviceId, requestId, code) {
  return sendDataPush(deviceId, {
    action: "submit_registration_code",
    request_id: requestId,
    code: String(code).replace(/\D/g, ""),
  });
}

async function sendExportSessionPush(deviceId, requestId, sessionLabel) {
  return sendDataPush(deviceId, {
    action: "export_session",
    request_id: requestId,
    session_label: sessionLabel,
  });
}

async function sendMacroHomePush(deviceId, requestId) {
  return sendDataPush(deviceId, {
    action: "macro_home",
    request_id: requestId,
  });
}

async function sendMacroOpenWhatsappPush(deviceId, requestId) {
  return sendDataPush(deviceId, {
    action: "macro_open_whatsapp",
    request_id: requestId,
  });
}

async function sendMacroNavigateLinkPhonePush(deviceId, requestId) {
  return sendDataPush(deviceId, {
    action: "macro_navigate_link_phone",
    request_id: requestId,
  });
}

async function sendSubmitPairingCodePush(deviceId, requestId, pairingCode, evolutionInstance) {
  const data = {
    action: "submit_pairing_code",
    request_id: requestId,
    pairing_code: String(pairingCode).replace(/\s/g, "").toUpperCase(),
  };
  if (evolutionInstance) data.evolution_instance = evolutionInstance;
  return sendDataPush(deviceId, data);
}

function fcmStatus() {
  initFirebase();
  const tokens = readTokens();
  return {
    enabled: isEnabled(),
    initialized: Boolean(messaging),
    error: initError,
    registered_devices: Object.keys(tokens),
  };
}

function listRegisteredDevices() {
  const tokens = readTokens();
  return Object.entries(tokens).map(([device_id, entry]) => ({
    device_id,
    fcm_updated_at: entry?.updated_at || null,
  }));
}

module.exports = {
  isEnabled,
  saveFcmToken,
  getFcmToken,
  deleteFcmToken,
  sendSyncPush,
  sendSwitchSessionPush,
  sendClearSessionPush,
  sendRegisterWhatsappPush,
  sendSubmitRegistrationCodePush,
  sendExportSessionPush,
  sendSubmitPairingCodePush,
  sendMacroHomePush,
  sendMacroOpenWhatsappPush,
  sendMacroNavigateLinkPhonePush,
  fcmStatus,
  listRegisteredDevices,
};
