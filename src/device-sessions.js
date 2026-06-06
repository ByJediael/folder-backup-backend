const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const SESSIONS_FILE = path.join(DATA_DIR, "device-sessions.json");

function readAll() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function upsertDeviceSessions(deviceId, sessions) {
  const all = readAll();
  all[deviceId] = {
    updated_at: new Date().toISOString(),
    sessions: Array.isArray(sessions) ? sessions : [],
  };
  writeAll(all);
  return all[deviceId];
}

function listForDevice(deviceId) {
  return readAll()[deviceId]?.sessions || [];
}

function clearDeviceSessions(deviceId) {
  const all = readAll();
  if (!all[deviceId]) return false;
  delete all[deviceId];
  writeAll(all);
  return true;
}

function listAllFlat() {
  const all = readAll();
  const rows = [];
  for (const [device_id, entry] of Object.entries(all)) {
    for (const s of entry.sessions || []) {
      rows.push({
        device_id,
        inventory_updated_at: entry.updated_at,
        ...s,
      });
    }
  }
  return rows.sort((a, b) => (b.exported_at || "").localeCompare(a.exported_at || ""));
}

module.exports = {
  upsertDeviceSessions,
  listForDevice,
  listAllFlat,
  readAll,
  clearDeviceSessions,
};
