const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const STATUS_FILE = path.join(DATA_DIR, "whatsapp-register-status.json");

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

function getRegisterStatus(deviceId) {
  const entry = readAll()[deviceId];
  return (
    entry || {
      device_id: deviceId,
      status: "idle",
      message: "Nenhum cadastro recente",
      request_id: null,
      command: null,
      session_label: null,
      phone_e164: null,
      updated_at: null,
    }
  );
}

function setRegisterDispatched(deviceId, requestId, fields) {
  const map = readAll();
  map[deviceId] = {
    device_id: deviceId,
    request_id: requestId,
    command: fields.command,
    session_label: fields.session_label ?? null,
    phone_e164: fields.phone_e164 ?? null,
    status: "dispatched",
    message: fields.message || "Push enviado — aguardando celular",
    updated_at: new Date().toISOString(),
  };
  writeAll(map);
  return map[deviceId];
}

function clearRegisterStatus(deviceId) {
  const map = readAll();
  if (!map[deviceId]) return false;
  delete map[deviceId];
  writeAll(map);
  return true;
}

function updateRegisterFromDevice(deviceId, body) {
  const map = readAll();
  const prev = map[deviceId] || {};
  map[deviceId] = {
    ...prev,
    device_id: deviceId,
    request_id: body.request_id ?? prev.request_id,
    command: body.command ?? prev.command,
    session_label: body.session_label ?? prev.session_label,
    phone_e164: body.phone_e164 ?? prev.phone_e164,
    status: body.status || prev.status || "idle",
    message: body.message ?? prev.message ?? "",
    updated_at: new Date().toISOString(),
  };
  writeAll(map);
  return map[deviceId];
}

module.exports = {
  getRegisterStatus,
  setRegisterDispatched,
  updateRegisterFromDevice,
  clearRegisterStatus,
};
