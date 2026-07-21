/**
 * Código de pairing ativo por device + instância Evolution.
 * Evita pedir código novo à Evolution enquanto o anterior ainda vale
 * (cada connect/logout invalida o código anterior).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const FILE = path.join(DATA_DIR, "active-pairing.json");
const TTL_MS = Number(process.env.PAIRING_CODE_TTL_MS || 120_000);

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ sessions: [] }, null, 2), "utf8");
  }
}

function readAll() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { sessions: [] };
  }
}

function writeAll(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function isExpired(row) {
  if (!row?.expires_at) return true;
  return Date.now() >= new Date(row.expires_at).getTime();
}

function expireStale() {
  const data = readAll();
  let changed = false;
  data.sessions = (data.sessions || []).map((s) => {
    if (s.status === "active" && isExpired(s)) {
      changed = true;
      return { ...s, status: "expired", expired_at: new Date().toISOString() };
    }
    return s;
  });
  if (changed) writeAll(data);
}

/** Código ativo ainda válido (não expirado, não concluído). */
function getActive(deviceId, evolutionInstance) {
  expireStale();
  const device = String(deviceId || "");
  const instance = String(evolutionInstance || "");
  return (readAll().sessions || []).find(
    (s) =>
      s.device_id === device &&
      s.evolution_instance === instance &&
      s.status === "active" &&
      !isExpired(s),
  ) || null;
}

function register({ device_id, evolution_instance, pairing_code, request_id, phone_e164, nav_request_id }) {
  expireStale();
  const data = readAll();
  const now = Date.now();
  const code = String(pairing_code || "").replace(/\s/g, "").toUpperCase();
  const device = String(device_id || "");
  const instance = String(evolution_instance || "");

  data.sessions = (data.sessions || []).map((s) => {
    if (s.device_id === device && s.evolution_instance === instance && s.status === "active") {
      return { ...s, status: "superseded", superseded_at: new Date().toISOString() };
    }
    return s;
  });

  const row = {
    id: `ap-${crypto.randomUUID().slice(0, 8)}`,
    device_id: device,
    evolution_instance: instance,
    phone_e164: phone_e164 || null,
    request_id: request_id || null,
    nav_request_id: nav_request_id || null,
    pairing_code: code,
    status: "active",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
    submitted_at: null,
    completed_at: null,
    failed_at: null,
    error: null,
  };
  data.sessions.push(row);
  writeAll(data);
  return row;
}

function findByRequestId(requestId) {
  const id = String(requestId || "");
  return (readAll().sessions || []).find((s) => s.request_id === id) || null;
}

function update(id, patch) {
  const data = readAll();
  let found = null;
  data.sessions = (data.sessions || []).map((s) => {
    if (s.id !== id) return s;
    found = { ...s, ...patch };
    return found;
  });
  writeAll(data);
  return found;
}

function markSubmitted(requestId) {
  const row = findByRequestId(requestId);
  if (!row || row.status !== "active") return row;
  return update(row.id, { submitted_at: new Date().toISOString() });
}

function markCompleted(requestId) {
  const row = findByRequestId(requestId);
  if (!row) return null;
  return update(row.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });
}

function markFailed(requestId, error) {
  const row = findByRequestId(requestId);
  if (!row) return null;
  return update(row.id, {
    status: "failed",
    failed_at: new Date().toISOString(),
    error: error || "pairing_failed",
  });
}

function cancelForDevice(deviceId, { except_request_id } = {}) {
  const device = String(deviceId || "");
  const except = except_request_id ? String(except_request_id) : null;
  const data = readAll();
  let changed = false;
  data.sessions = (data.sessions || []).map((s) => {
    if (s.device_id !== device || s.status !== "active") return s;
    if (except && s.request_id === except) return s;
    changed = true;
    return { ...s, status: "cancelled", cancelled_at: new Date().toISOString() };
  });
  if (changed) writeAll(data);
}

function clearForInstance(evolutionInstance) {
  const instance = String(evolutionInstance || "");
  const data = readAll();
  data.sessions = (data.sessions || []).map((s) => {
    if (s.evolution_instance !== instance || s.status !== "active") return s;
    return { ...s, status: "cancelled", cancelled_at: new Date().toISOString() };
  });
  writeAll(data);
}

module.exports = {
  TTL_MS,
  getActive,
  register,
  findByRequestId,
  markSubmitted,
  markCompleted,
  markFailed,
  cancelForDevice,
  clearForInstance,
  expireStale,
  list: () => readAll().sessions || [],
};
