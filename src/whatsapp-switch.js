const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const STATUS_FILE = path.join(DATA_DIR, "whatsapp-switch-status.json");

function readAll() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATUS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(map) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(map, null, 2), "utf8");
}

function getStatus(deviceId) {
  const entry = readAll()[deviceId];
  return (
    entry || {
      device_id: deviceId,
      status: "idle",
      message: "Nenhuma troca recente",
      request_id: null,
      session_label: null,
      updated_at: null,
    }
  );
}

function setDispatched(deviceId, requestId, sessionLabel) {
  const map = readAll();
  map[deviceId] = {
    device_id: deviceId,
    request_id: requestId,
    session_label: sessionLabel,
    status: "dispatched",
    message: `Push enviado — aguardando celular (${sessionLabel})`,
    updated_at: new Date().toISOString(),
  };
  writeAll(map);
  return map[deviceId];
}

function clearStatus(deviceId) {
  const map = readAll();
  if (!map[deviceId]) return false;
  delete map[deviceId];
  writeAll(map);
  return true;
}

function updateFromDevice(deviceId, body) {
  const map = readAll();
  const prev = map[deviceId] || {};
  map[deviceId] = {
    ...prev,
    device_id: deviceId,
    request_id: body.request_id ?? prev.request_id,
    session_label: body.session_label ?? prev.session_label,
    status: body.status || prev.status || "idle",
    message: body.message ?? prev.message ?? "",
    updated_at: new Date().toISOString(),
  };
  writeAll(map);
  return map[deviceId];
}

module.exports = {
  getStatus,
  setDispatched,
  updateFromDevice,
  clearStatus,
};
