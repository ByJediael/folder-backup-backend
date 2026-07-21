/**
 * Fila de ações WhatsApp por device (funciona sem FCM).
 * O APK busca em GET /devices/:id/commands.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const FILE = path.join(DATA_DIR, "device-actions.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ actions: [] }, null, 2), "utf8");
  }
}

function readAll() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { actions: [] };
  }
}

function writeAll(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @param {object} fields
 * @param {string} fields.device_id
 * @param {string} fields.action - submit_pairing_code | register_whatsapp | clear_session | ...
 */
function enqueue(fields) {
  const data = readAll();
  const code = fields.pairing_code
    ? String(fields.pairing_code).replace(/\s/g, "").toUpperCase()
    : null;

  if (fields.action === "submit_pairing_code" && code) {
    const duplicate = (data.actions || []).find(
      (a) =>
        a.device_id === fields.device_id &&
        a.action === "submit_pairing_code" &&
        a.status === "pending" &&
        String(a.pairing_code || "").toUpperCase() === code,
    );
    if (duplicate) return duplicate;

    data.actions = (data.actions || []).map((a) => {
      if (
        a.device_id === fields.device_id &&
        a.action === "submit_pairing_code" &&
        a.status === "pending"
      ) {
        return {
          ...a,
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_reason: "superseded_by_new_code",
        };
      }
      return a;
    });
  }

  const action = {
    id: `act-${crypto.randomUUID().slice(0, 8)}`,
    device_id: fields.device_id,
    action: fields.action,
    request_id: fields.request_id || `act-${crypto.randomUUID().slice(0, 8)}`,
    pairing_code: code,
    evolution_instance: fields.evolution_instance || null,
    phone_e164: fields.phone_e164 || null,
    session_label: fields.session_label || null,
    display_name: fields.display_name || null,
    status: "pending",
    created_at: new Date().toISOString(),
    dispatched_at: null,
  };
  data.actions = data.actions || [];
  data.actions.push(action);
  writeAll(data);
  return action;
}

function cancelPending(deviceId, actionName, { except_request_id } = {}) {
  const data = readAll();
  const device = String(deviceId || "");
  const except = except_request_id ? String(except_request_id) : null;
  let changed = false;
  data.actions = (data.actions || []).map((a) => {
    if (a.device_id !== device || a.status !== "pending") return a;
    if (actionName && a.action !== actionName) return a;
    if (except && a.request_id === except) return a;
    changed = true;
    return {
      ...a,
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: "superseded",
    };
  });
  if (changed) writeAll(data);
}

/** Retorna o comando WA mais antigo e marca só ele como dispatched (evita open+nav no mesmo poll). */
function takePending(deviceId) {
  const data = readAll();
  const pending = (data.actions || [])
    .filter((a) => a.device_id === deviceId && a.status === "pending")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (pending.length === 0) return [];

  const next = pending[0];
  const now = new Date().toISOString();
  data.actions = data.actions.map((a) => {
    if (a.id === next.id && a.status === "pending") {
      return { ...a, status: "dispatched", dispatched_at: now };
    }
    return a;
  });
  writeAll(data);
  return [next];
}

function list({ device_id, status, limit = 50 } = {}) {
  let rows = readAll().actions || [];
  if (device_id) rows = rows.filter((a) => a.device_id === device_id);
  if (status) rows = rows.filter((a) => a.status === status);
  return rows.slice(-limit);
}

module.exports = {
  enqueue,
  takePending,
  cancelPending,
  list,
};
