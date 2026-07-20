/**
 * Orquestra: Evolution create/pair → enfileira ação no celular → opcionalmente espera open.
 */
const crypto = require("crypto");
const evolution = require("./evolution");
const slots = require("./slots");
const deviceActions = require("./device-actions");
const { sendSubmitPairingCodePush, sendMacroNavigateLinkPhonePush } = require("./fcm");

async function linkWhatsappToEvolution({
  device_id,
  phone_e164,
  evolution_instance,
  navigate_first = true,
  wait_open_ms = 0,
}) {
  const phone = String(phone_e164 || "").replace(/\D/g, "");
  if (!device_id) return { ok: false, error: "device_id_obrigatorio" };
  if (!phone) return { ok: false, error: "phone_e164_obrigatorio" };

  const instance =
    evolution_instance ||
    `wa-${phone.slice(-10)}`;

  const request_id = `link-${crypto.randomUUID().slice(0, 8)}`;

  const created = await evolution.createInstance(instance, phone);
  // 409 / já existe = ok

  let navPush = { ok: false, skipped: true, reason: "navigate_skipped" };
  if (navigate_first) {
    navPush = await sendMacroNavigateLinkPhonePush(device_id, `${request_id}-nav`);
    deviceActions.enqueue({
      device_id,
      action: "macro_navigate_link_phone",
      request_id: `${request_id}-nav`,
    });
    // dá tempo do menu abrir antes do código (APK processa em sequência no poll)
    await new Promise((r) => setTimeout(r, 2000));
  }

  const conn = await evolution.connectWithPairing(instance, phone);
  if (!conn.ok) {
    return {
      ok: false,
      error: conn.error || "pairing_failed",
      evolution_instance: instance,
      created,
      nav_fcm: navPush,
    };
  }

  const pairingCode = evolution.extractPairingCode(conn.data) || conn.pairing_code;
  if (!pairingCode) {
    return {
      ok: false,
      error: "pairing_code_not_returned",
      evolution_instance: instance,
      raw: conn.data,
    };
  }

  slots.upsertSlot({
    ...(slots.findByEvolutionInstance(instance) || {
      slot_id: `slot-${instance}`,
      label: instance,
      device_id,
      evolution_instance: instance,
    }),
    slot_id: slots.findByEvolutionInstance(instance)?.slot_id || `slot-${instance}`,
    device_id,
    evolution_instance: instance,
    phone_e164: `+${phone}`,
    pool_status: "remounting",
    evo_status: "qr",
    last_message: `Pairing ${pairingCode} enviado ao device`,
  });

  const fcmPush = await sendSubmitPairingCodePush(
    device_id,
    request_id,
    pairingCode,
    instance,
  );

  const queued = deviceActions.enqueue({
    device_id,
    action: "submit_pairing_code",
    request_id,
    pairing_code: pairingCode,
    evolution_instance: instance,
    phone_e164: `+${phone}`,
  });

  let finalState = evolution.mapConnectionState(conn.data);
  if (wait_open_ms > 0) {
    const deadline = Date.now() + wait_open_ms;
    while (Date.now() < deadline) {
      const st = await evolution.connectionState(instance);
      if (st.ok) {
        finalState = evolution.mapConnectionState(st.data);
        if (finalState === "open") break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (finalState === "open") {
    const slot = slots.findByEvolutionInstance(instance);
    if (slot) {
      slots.upsertSlot({
        ...slot,
        pool_status: "online",
        in_pool: true,
        evo_status: "open",
        last_message: "Evolution open — no pool",
        last_check: new Date().toISOString(),
      });
    }
  }

  return {
    ok: true,
    evolution_instance: instance,
    phone_e164: `+${phone}`,
    pairing_code: pairingCode,
    request_id,
    device_id,
    queued_action_id: queued.id,
    fcm_ok: fcmPush.ok,
    fcm_skipped: Boolean(fcmPush.skipped),
    fcm_error: fcmPush.error || fcmPush.reason || null,
    nav_fcm_ok: navPush.ok,
    connection_state: finalState,
    delivery: fcmPush.ok
      ? "fcm+queue"
      : "queue_only_apk_must_poll",
  };
}

module.exports = {
  linkWhatsappToEvolution,
};
