const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getStatus } = require("./whatsapp-switch");
const { getRegisterStatus } = require("./whatsapp-register");
const { getFcmToken, listRegisteredDevices } = require("./fcm");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const SLOTS_FILE = path.join(DATA_DIR, "slots.json");

const DEFAULT_SLOTS = [
  { slot_id: "slot-01", label: "Celular 1", device_id: "phone-01", evolution_instance: "wa-01", session_label: "" },
  { slot_id: "slot-02", label: "Celular 2", device_id: "phone-02", evolution_instance: "wa-02", session_label: "" },
  { slot_id: "slot-03", label: "Celular 3", device_id: "phone-03", evolution_instance: "wa-03", session_label: "" },
  { slot_id: "slot-04", label: "Celular 4", device_id: "phone-04", evolution_instance: "wa-04", session_label: "" },
  { slot_id: "slot-05", label: "Celular 5", device_id: "phone-05", evolution_instance: "wa-05", session_label: "" },
  { slot_id: "slot-06", label: "Mi 9 SE", device_id: "mi9-se", evolution_instance: "wa-06", session_label: "numero-timv2" },
];

function readSlotsFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SLOTS_FILE)) {
    const initial = {
      slots: DEFAULT_SLOTS.map((s) => ({
        ...s,
        phone_e164: null,
        phone_status: "idle",
        evo_status: "unknown",
        pool_status: "offline",
        in_pool: true,
        last_check: null,
        ban_count: 0,
        remount_count: 0,
        last_message: null,
        updated_at: new Date().toISOString(),
      })),
    };
    writeSlotsFile(initial);
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(SLOTS_FILE, "utf8"));
  } catch {
    return { slots: [] };
  }
}

function writeSlotsFile(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SLOTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function listSlots() {
  return readSlotsFile().slots || [];
}

function findByDeviceId(deviceId) {
  return listSlots().find((s) => s.device_id === deviceId) || null;
}

function findByEvolutionInstance(instance) {
  return listSlots().find((s) => s.evolution_instance === instance) || null;
}

function findBySlotId(slotId) {
  return listSlots().find((s) => s.slot_id === slotId) || null;
}

function upsertSlot(patch) {
  const data = readSlotsFile();
  const slots = data.slots || [];
  const idx = slots.findIndex((s) => s.slot_id === patch.slot_id);
  const now = new Date().toISOString();

  if (idx >= 0) {
    slots[idx] = { ...slots[idx], ...patch, updated_at: now };
  } else {
    slots.push({
      slot_id: patch.slot_id || `slot-${crypto.randomUUID().slice(0, 6)}`,
      label: patch.label || "Novo slot",
      device_id: patch.device_id || "",
      evolution_instance: patch.evolution_instance || "",
      session_label: patch.session_label || "",
      phone_e164: patch.phone_e164 ?? null,
      phone_status: patch.phone_status || "idle",
      evo_status: patch.evo_status || "unknown",
      pool_status: patch.pool_status || "offline",
      in_pool: patch.in_pool !== false,
      last_check: patch.last_check ?? null,
      ban_count: Number(patch.ban_count) || 0,
      remount_count: Number(patch.remount_count) || 0,
      last_message: patch.last_message ?? null,
      updated_at: now,
    });
  }

  writeSlotsFile({ slots });
  return findBySlotId(patch.slot_id) || slots[slots.length - 1];
}

function updateSlotByDevice(deviceId, patch) {
  const slot = findByDeviceId(deviceId);
  if (!slot) return null;
  return upsertSlot({ ...slot, ...patch, slot_id: slot.slot_id });
}

function updateSlotByEvolution(instance, patch) {
  const slot = findByEvolutionInstance(instance);
  if (!slot) return null;
  return upsertSlot({ ...slot, ...patch, slot_id: slot.slot_id });
}

function enrichSlot(slot) {
  const switchSt = slot.device_id ? getStatus(slot.device_id) : null;
  const regSt = slot.device_id ? getRegisterStatus(slot.device_id) : null;
  const fcmRegistered = Boolean(slot.device_id && getFcmToken(slot.device_id));

  let phone_status = slot.phone_status || "idle";
  let last_message = slot.last_message;

  if (regSt?.status && regSt.status !== "idle") {
    phone_status = regSt.status;
    last_message = regSt.message || last_message;
  } else if (switchSt?.status && switchSt.status !== "idle") {
    phone_status = switchSt.status;
    last_message = switchSt.message || last_message;
  }

  const pool_status =
    slot.pool_status ||
    (slot.evo_status === "open" && slot.phone_e164 ? "online" : "offline");

  return {
    ...slot,
    phone_status,
    pool_status,
    in_pool: slot.in_pool !== false,
    last_check: slot.last_check ?? null,
    ban_count: Number(slot.ban_count) || 0,
    remount_count: Number(slot.remount_count) || 0,
    last_message,
    fcm_registered: fcmRegistered,
    switch_status: switchSt,
    register_status: regSt,
  };
}

function listSlotsEnriched() {
  return listSlots().map(enrichSlot);
}

/** Celulares com APK online (FCM registrado) — usado na aba Operação. */
function listConnectedDevices() {
  return listRegisteredDevices().map(({ device_id, fcm_updated_at }) => {
    const slot = findByDeviceId(device_id);
    const base = slot || {
      slot_id: null,
      label: device_id,
      device_id,
      evolution_instance: "",
      session_label: "",
      phone_e164: null,
      phone_status: "idle",
      evo_status: "unknown",
      last_message: null,
    };
    const enriched = enrichSlot(base);
    return {
      ...enriched,
      fcm_updated_at,
      has_slot: Boolean(slot),
    };
  });
}

module.exports = {
  listSlots,
  listSlotsEnriched,
  listConnectedDevices,
  enrichSlot,
  findByDeviceId,
  findByEvolutionInstance,
  findBySlotId,
  upsertSlot,
  updateSlotByDevice,
  updateSlotByEvolution,
};
