/**
 * Health check Evolution → atualiza pool_status dos slots.
 * online = open na Evolution e elegível para o link
 * offline = desconectado (sai do rodízio)
 * remounting = não sobrescrever (fila de remonta)
 */
const evolution = require("./evolution");
const slots = require("./slots");

async function checkSlot(slot) {
  const now = new Date().toISOString();
  if (!slot.evolution_instance) {
    return slots.upsertSlot({
      ...slot,
      pool_status: slot.pool_status === "remounting" ? "remounting" : "offline",
      last_check: now,
      last_message: slot.last_message || "Sem evolution_instance",
    });
  }

  if (slot.pool_status === "remounting") {
    return slots.upsertSlot({
      ...slot,
      last_check: now,
    });
  }

  if (!evolution.isEnabled()) {
    const derived =
      slot.evo_status === "open" && slot.phone_e164 ? "online" : "offline";
    return slots.upsertSlot({
      ...slot,
      pool_status: derived,
      last_check: now,
      last_message: "Evolution desabilitada — status derivado de evo_status",
    });
  }

  const st = await evolution.connectionState(slot.evolution_instance);
  if (!st.ok) {
    return slots.upsertSlot({
      ...slot,
      pool_status: "offline",
      evo_status: "unknown",
      last_check: now,
      last_message: `Health fail: ${st.error || st.status}`,
    });
  }

  const mapped = evolution.mapConnectionState(st.data);
  if (mapped === "open") {
    return slots.upsertSlot({
      ...slot,
      evo_status: "open",
      pool_status: slot.phone_e164 ? "online" : "offline",
      last_check: now,
      last_message: slot.phone_e164
        ? "Evolution open — no pool"
        : "Evolution open — falta phone_e164",
    });
  }

  return slots.upsertSlot({
    ...slot,
    evo_status: mapped,
    pool_status: "offline",
    last_check: now,
    last_message: `Evolution ${mapped} — fora do pool`,
  });
}

async function syncAll() {
  const list = slots.listSlots();
  const updated = [];
  for (const slot of list) {
    updated.push(await checkSlot(slot));
  }
  const summary = {
    total: updated.length,
    online: updated.filter((s) => s.pool_status === "online").length,
    offline: updated.filter((s) => s.pool_status === "offline").length,
    remounting: updated.filter((s) => s.pool_status === "remounting").length,
    at: new Date().toISOString(),
  };
  return { slots: updated.map(slots.enrichSlot), summary };
}

function markOffline(slotId, message) {
  const slot = slots.findBySlotId(slotId);
  if (!slot) return null;
  return slots.upsertSlot({
    ...slot,
    pool_status: "offline",
    in_pool: false,
    last_message: message || "Marcado offline (admin)",
    last_check: new Date().toISOString(),
  });
}

function markOnline(slotId, message) {
  const slot = slots.findBySlotId(slotId);
  if (!slot) return null;
  if (!slot.phone_e164) {
    return { error: "phone_e164 obrigatório para online", slot };
  }
  return slots.upsertSlot({
    ...slot,
    pool_status: "online",
    in_pool: true,
    evo_status: slot.evo_status === "open" ? "open" : slot.evo_status,
    last_message: message || "Marcado online (admin)",
    last_check: new Date().toISOString(),
  });
}

function applyEvolutionWebhook(instance, evoStatus) {
  const slot = slots.findByEvolutionInstance(instance);
  if (!slot) return null;
  if (slot.pool_status === "remounting") {
    return slots.upsertSlot({
      ...slot,
      evo_status: evoStatus,
      last_check: new Date().toISOString(),
      last_message: `Webhook ${evoStatus} (remounting)`,
    });
  }
  if (evoStatus === "open") {
    return slots.upsertSlot({
      ...slot,
      evo_status: "open",
      pool_status: slot.phone_e164 ? "online" : "offline",
      in_pool: Boolean(slot.phone_e164),
      last_check: new Date().toISOString(),
      last_message: "Webhook: connected",
    });
  }
  if (evoStatus === "close") {
    return slots.upsertSlot({
      ...slot,
      evo_status: "close",
      pool_status: "offline",
      last_check: new Date().toISOString(),
      last_message: "Webhook: disconnected",
      ban_count: (Number(slot.ban_count) || 0) + 1,
    });
  }
  return slots.upsertSlot({
    ...slot,
    evo_status: evoStatus,
    pool_status: "offline",
    last_check: new Date().toISOString(),
  });
}

module.exports = {
  checkSlot,
  syncAll,
  markOffline,
  markOnline,
  applyEvolutionWebhook,
};
