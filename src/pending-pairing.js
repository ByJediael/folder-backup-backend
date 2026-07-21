/**
 * Links Evolution: force-stop → home → pedir código (WA na inicial) → nav → digitar.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const FILE = path.join(DATA_DIR, "pending-pairing.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ pending: [] }, null, 2), "utf8");
  }
}

function readAll() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { pending: [] };
  }
}

function writeAll(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function save(entry) {
  const data = readAll();
  const row = {
    id: `pp-${crypto.randomUUID().slice(0, 8)}`,
    request_id: entry.request_id,
    nav_request_id: entry.nav_request_id,
    stop_request_id: entry.stop_request_id || null,
    home_request_id: entry.home_request_id || null,
    device_id: entry.device_id,
    phone_e164: entry.phone_e164,
    evolution_instance: entry.evolution_instance,
    wait_open_ms: entry.wait_open_ms || 0,
    force_new: Boolean(entry.force_new),
    status: entry.status || "awaiting_force_stop",
    created_at: new Date().toISOString(),
    pairing_code: null,
    error: null,
  };
  data.pending = data.pending || [];
  data.pending.push(row);
  writeAll(data);
  return row;
}

function findByNavRequestId(navRequestId) {
  const id = String(navRequestId || "");
  return (readAll().pending || []).find((p) => p.nav_request_id === id);
}

function findByStopRequestId(stopRequestId) {
  const id = String(stopRequestId || "");
  return (readAll().pending || []).find((p) => p.stop_request_id === id);
}

function findByHomeRequestId(homeRequestId) {
  const id = String(homeRequestId || "");
  return (readAll().pending || []).find((p) => p.home_request_id === id);
}

function findAwaitingByNavRequestId(navRequestId) {
  const row = findByNavRequestId(navRequestId);
  if (!row || row.status !== "awaiting_navigation") return null;
  return row;
}

function cancelForDevice(deviceId, { except_request_id } = {}) {
  const device = String(deviceId || "");
  const except = except_request_id ? String(except_request_id) : null;
  const data = readAll();
  let changed = false;
  data.pending = (data.pending || []).map((p) => {
    if (p.device_id !== device) return p;
    if (["completed", "failed", "cancelled"].includes(p.status)) return p;
    if (except && p.request_id === except) return p;
    changed = true;
    return {
      ...p,
      status: "cancelled",
      error: "superseded_by_new_link",
      cancelled_at: new Date().toISOString(),
    };
  });
  if (changed) writeAll(data);
}

function findByRequestId(requestId) {
  const id = String(requestId || "");
  return (readAll().pending || []).find((p) => p.request_id === id);
}

function update(id, patch) {
  const data = readAll();
  let found = null;
  data.pending = (data.pending || []).map((p) => {
    if (p.id !== id) return p;
    found = { ...p, ...patch };
    return found;
  });
  writeAll(data);
  return found;
}

function remove(id) {
  const data = readAll();
  data.pending = (data.pending || []).filter((p) => p.id !== id);
  writeAll(data);
}

function markFailedByNavRequestId(navRequestId, error) {
  const row = findByNavRequestId(navRequestId);
  if (!row || row.status !== "awaiting_navigation") return null;
  return update(row.id, { status: "failed", error: error || "navigation_failed" });
}

module.exports = {
  save,
  findByNavRequestId,
  findByStopRequestId,
  findByHomeRequestId,
  findAwaitingByNavRequestId,
  findByRequestId,
  update,
  remove,
  markFailedByNavRequestId,
  cancelForDevice,
  list: () => readAll().pending || [],
};
