/**
 * Orquestra: fechar WA → home → criar instância + código (celular na inicial)
 * → menu dispositivos → digitar código → anti-golpe → nome.
 */
const crypto = require("crypto");
const evolution = require("./evolution");
const slots = require("./slots");
const deviceActions = require("./device-actions");
const pendingPairing = require("./pending-pairing");
const activePairing = require("./active-pairing");
const adbHelper = require("./adb-helper");
const { sendSubmitPairingCodePush, sendMacroNavigateLinkPhonePush, sendMacroOpenWhatsappPush, sendMacroForceStopWhatsappPush } = require("./fcm");

/**
 * Pede código à Evolution OU reutiliza o ativo (evita invalidar por logout/connect).
 */
async function obtainPairingCode({
  device_id,
  instance,
  phone,
  request_id,
  nav_request_id,
  phone_e164,
  force_new = false,
}) {
  if (!force_new) {
    const active = activePairing.getActive(device_id, instance);
    if (active?.pairing_code) {
      return {
        ok: true,
        pairing_code: active.pairing_code,
        reused: true,
        request_id: active.request_id || request_id,
        expires_at: active.expires_at,
        connData: null,
        connection_state: "connecting",
      };
    }
  } else {
    activePairing.clearForInstance(instance);
  }

  const conn = await evolution.connectWithPairing(instance, phone, { force_new });
  if (!conn.ok) {
    if (conn.error === "pairing_in_progress" && !force_new) {
      const active = activePairing.getActive(device_id, instance);
      if (active?.pairing_code) {
        return {
          ok: true,
          pairing_code: active.pairing_code,
          reused: true,
          request_id: active.request_id || request_id,
          expires_at: active.expires_at,
          connData: null,
          connection_state: "connecting",
        };
      }
    }
    if (conn.error === "pairing_in_progress") {
      const pending = pendingPairing.findByRequestId(request_id);
      if (pending?.pairing_code) {
        return {
          ok: true,
          pairing_code: pending.pairing_code,
          reused: true,
          request_id,
          expires_at: activePairing.getActive(device_id, instance)?.expires_at || null,
          connData: null,
          connection_state: "connecting",
        };
      }
    }
    return { ok: false, error: conn.error || "pairing_failed", conn };
  }

  const pairingCode = evolution.extractPairingCode(conn.data) || conn.pairing_code;
  if (!pairingCode) {
    return { ok: false, error: "pairing_code_not_returned", raw: conn.data };
  }

  const session = activePairing.register({
    device_id,
    evolution_instance: instance,
    pairing_code: pairingCode,
    request_id,
    phone_e164: phone_e164 || `+${phone}`,
    nav_request_id,
  });

  const state = conn.data ? evolution.mapConnectionState(conn.data) : "connecting";

  return {
    ok: true,
    pairing_code: pairingCode,
    reused: false,
    request_id,
    expires_at: session.expires_at,
    connData: conn.data,
    connection_state: state === "unknown" ? "connecting" : state,
  };
}

async function enqueuePairingCode({
  device_id,
  request_id,
  instance,
  phone,
  pairingCode,
  wait_open_ms = 0,
  connData = null,
  reused = false,
}) {
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
    evo_status: "connecting",
    last_message: reused
      ? `Reenviando pairing ${pairingCode} (mesmo código)`
      : `Pairing ${pairingCode} enviado ao device`,
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

  activePairing.markSubmitted(request_id);

  const adbSerial = process.env.ADB_SERIAL || null;
  if (adbSerial) {
    setTimeout(async () => {
      try {
        const typed = await adbHelper.typePairingCode(adbSerial, pairingCode);
        console.log("[adb-type-pairing]", {
          device_id,
          request_id,
          code: pairingCode,
          ...typed,
        });
      } catch (err) {
        console.warn("[adb-type-pairing]", err.message || err);
      }
    }, 4_000);
    for (const delayMs of [10_000, 12_000, 14_000, 16_000, 18_000]) {
      setTimeout(async () => {
        try {
          await adbHelper.tapScamOkButton(adbSerial);
          const tapped = await adbHelper.tapScamConnectButton(adbSerial);
          console.log("[adb-scam-connect]", { device_id, request_id, delayMs, ...tapped });
        } catch (err) {
          console.warn("[adb-scam-connect]", err.message || err);
        }
      }, delayMs);
    }
  }

  let finalState = connData ? evolution.mapConnectionState(connData) : "connecting";
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
    activePairing.markCompleted(request_id);
  }

  return {
    pairing_code: pairingCode,
    queued_action_id: queued.id,
    fcm_ok: fcmPush.ok,
    fcm_skipped: Boolean(fcmPush.skipped),
    fcm_error: fcmPush.error || fcmPush.reason || null,
    connection_state: finalState,
    reused,
    delivery: fcmPush.ok ? "fcm+queue" : "queue_only_apk_must_poll",
  };
}

async function linkWhatsappToEvolution({
  device_id,
  phone_e164,
  evolution_instance,
  navigate_first = true,
  wait_open_ms = 0,
  force_new = false,
}) {
  const phone = String(phone_e164 || "").replace(/\D/g, "");
  if (!device_id) return { ok: false, error: "device_id_obrigatorio" };
  if (!phone) return { ok: false, error: "phone_e164_obrigatorio" };

  const instance = evolution_instance || `wa-${phone.slice(-10)}`;
  const request_id = `link-${crypto.randomUUID().slice(0, 8)}`;
  const stop_request_id = `${request_id}-stop`;
  const home_request_id = `${request_id}-home`;
  const nav_request_id = `${request_id}-nav`;

  pendingPairing.cancelForDevice(device_id, { except_request_id: request_id });
  deviceActions.cancelPending(device_id);
  if (force_new) {
    activePairing.cancelForDevice(device_id);
  }

  let created = null;
  let navPush = { ok: false, skipped: true, reason: "navigate_skipped" };
  if (navigate_first) {
    const adbSerial = process.env.ADB_SERIAL || null;
    const adbA11y = await adbHelper.enableBackupAccessibility(adbSerial).catch((err) => ({
      ok: false,
      error: err.message || String(err),
    }));
    const adbStop = await adbHelper.forceStopWhatsapp(adbSerial).catch((err) => ({
      ok: false,
      error: err.message || String(err),
    }));

    await sendMacroForceStopWhatsappPush(device_id, stop_request_id);
    deviceActions.enqueue({
      device_id,
      action: "macro_force_stop_whatsapp",
      request_id: stop_request_id,
    });

    const pending = pendingPairing.save({
      request_id,
      nav_request_id,
      home_request_id,
      stop_request_id,
      device_id,
      phone_e164: `+${phone}`,
      evolution_instance: instance,
      wait_open_ms,
      force_new,
      status: "awaiting_force_stop",
    });

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
      evo_status: "close",
      last_message: adbStop.verified
        ? "WhatsApp fechado (adb) → abrindo na tela inicial…"
        : "Fechando WhatsApp por completo → tela inicial…",
    });

    return {
      ok: true,
      phase: "awaiting_force_stop",
      evolution_instance: instance,
      phone_e164: `+${phone}`,
      request_id,
      stop_request_id,
      home_request_id,
      nav_request_id,
      pending_id: pending.id,
      device_id,
      adb_force_stop: adbStop,
      adb_accessibility: adbA11y,
      message:
        "WA fechado por completo → home → Evolution (instância+código) → dispositivos conectados → digitar → anti-golpe → nome.",
    };
  }

  const ensured = await evolution.ensureFreshInstance(instance, phone, { force_new });
  if (!ensured.ok) {
    return {
      ok: false,
      error: ensured.error || "create_instance_failed",
      evolution_instance: instance,
      created: ensured.created,
    };
  }
  created = ensured.created;

  const obtained = await obtainPairingCode({
    device_id,
    instance,
    phone,
    request_id,
    phone_e164: `+${phone}`,
    force_new,
  });
  if (!obtained.ok) {
    return {
      ok: false,
      error: obtained.error || "pairing_failed",
      evolution_instance: instance,
      created,
      nav_fcm: navPush,
    };
  }

  const dispatched = await enqueuePairingCode({
    device_id,
    request_id,
    instance,
    phone,
    pairingCode: obtained.pairing_code,
    wait_open_ms,
    connData: obtained.connData,
    reused: obtained.reused,
  });

  return {
    ok: true,
    phase: "pairing_queued",
    evolution_instance: instance,
    phone_e164: `+${phone}`,
    request_id,
    device_id,
    created,
    nav_fcm_ok: navPush.ok,
    ...dispatched,
  };
}

/** Após force-stop → cria instância Evolution → abre WA na tela inicial (sem ir ao menu). */
async function dispatchOpenAfterForceStop(stopRequestId) {
  const pending = pendingPairing.findByStopRequestId(stopRequestId);
  if (!pending) {
    return { ok: false, error: "no_pending_pairing", stop_request_id: stopRequestId };
  }
  if (pending.status !== "awaiting_force_stop") {
    return {
      ok: false,
      error: "pending_not_ready",
      status: pending.status,
      stop_request_id: stopRequestId,
    };
  }

  const phone = String(pending.phone_e164 || "").replace(/\D/g, "");
  const instance = pending.evolution_instance;
  const forceNew = Boolean(pending.force_new);

  pendingPairing.update(pending.id, { status: "creating_instance" });
  slots.updateSlotByDevice(pending.device_id, {
    last_message: "WhatsApp fechado — criando instância Evolution…",
  });

  const ensured = await evolution.ensureFreshInstance(instance, phone, { force_new: forceNew });
  if (!ensured.ok) {
    pendingPairing.update(pending.id, {
      status: "failed",
      error: ensured.error || "create_instance_failed",
    });
    return {
      ok: false,
      error: ensured.error || "create_instance_failed",
      evolution_instance: instance,
      stop_request_id: stopRequestId,
    };
  }

  pendingPairing.update(pending.id, { status: "awaiting_home", instance_created: true });

  await sendMacroOpenWhatsappPush(pending.device_id, pending.home_request_id);
  deviceActions.enqueue({
    device_id: pending.device_id,
    action: "macro_open_whatsapp",
    request_id: pending.home_request_id,
  });

  slots.updateSlotByDevice(pending.device_id, {
    last_message: "Instância pronta — abrindo WhatsApp na tela inicial…",
    evo_status: "close",
  });

  return {
    ok: true,
    phase: "awaiting_home",
    request_id: pending.request_id,
    home_request_id: pending.home_request_id,
    device_id: pending.device_id,
    evolution_instance: instance,
    created: ensured.created,
  };
}

/**
 * WA na tela inicial → solicita código (instância já criada) → só então navega ao menu.
 */
async function dispatchPairingAfterHome(homeRequestId) {
  const pending = pendingPairing.findByHomeRequestId(homeRequestId);
  if (!pending) {
    return { ok: false, error: "no_pending_pairing", home_request_id: homeRequestId };
  }
  if (pending.status !== "awaiting_home") {
    return {
      ok: false,
      error: "pending_not_ready",
      status: pending.status,
      home_request_id: homeRequestId,
    };
  }

  const phone = String(pending.phone_e164 || "").replace(/\D/g, "");
  const instance = pending.evolution_instance;
  const forceNew = Boolean(pending.force_new);

  pendingPairing.update(pending.id, { status: "fetching_code" });

  slots.updateSlotByDevice(pending.device_id, {
    last_message: "Tela inicial OK — solicitando código de pareamento…",
  });

  if (!pending.instance_created) {
    const ensured = await evolution.ensureFreshInstance(instance, phone, { force_new: forceNew });
    if (!ensured.ok) {
      pendingPairing.update(pending.id, {
        status: "failed",
        error: ensured.error || "create_instance_failed",
      });
      return {
        ok: false,
        error: ensured.error || "create_instance_failed",
        evolution_instance: instance,
        home_request_id: homeRequestId,
      };
    }
    pendingPairing.update(pending.id, { instance_created: true });
  }

  const obtained = await obtainPairingCode({
    device_id: pending.device_id,
    instance,
    phone,
    request_id: pending.request_id,
    nav_request_id: pending.nav_request_id,
    phone_e164: pending.phone_e164,
    force_new: false,
  });

  if (!obtained.ok) {
    pendingPairing.update(pending.id, {
      status: "failed",
      error: obtained.error || "pairing_failed",
    });
    return {
      ok: false,
      error: obtained.error || "pairing_failed",
      evolution_instance: instance,
      home_request_id: homeRequestId,
    };
  }

  pendingPairing.update(pending.id, {
    status: "awaiting_navigation",
    pairing_code: obtained.pairing_code,
  });

  console.log("[pairing-code-ready]", {
    device_id: pending.device_id,
    request_id: pending.request_id,
    pairing_code: obtained.pairing_code,
    phase: "enqueue_nav",
  });

  await sendMacroNavigateLinkPhonePush(pending.device_id, pending.nav_request_id);
  deviceActions.enqueue({
    device_id: pending.device_id,
    action: "macro_navigate_link_from_home",
    request_id: pending.nav_request_id,
  });

  slots.updateSlotByDevice(pending.device_id, {
    last_message: `Código ${obtained.pairing_code} pronto — indo para dispositivos conectados…`,
    evo_status: obtained.connection_state || "connecting",
  });

  return {
    ok: true,
    phase: "awaiting_navigation",
    request_id: pending.request_id,
    nav_request_id: pending.nav_request_id,
    home_request_id: homeRequestId,
    device_id: pending.device_id,
    evolution_instance: instance,
    pairing_code: obtained.pairing_code,
    expires_at: obtained.expires_at,
    reused: obtained.reused,
  };
}

/** @deprecated use dispatchPairingAfterHome */
async function dispatchNavigationAfterHome(homeRequestId) {
  return dispatchPairingAfterHome(homeRequestId);
}

/** Tela do código pronta → enfileira digitar (código já obtido na tela inicial). */
async function dispatchPairingAfterNavigation(navRequestId) {
  const pending = pendingPairing.findByNavRequestId(navRequestId);
  if (!pending) {
    return { ok: false, error: "no_pending_pairing", nav_request_id: navRequestId };
  }

  if (pending.status === "pairing_queued" && pending.pairing_code) {
    return {
      ok: true,
      phase: "pairing_queued",
      reused: true,
      evolution_instance: pending.evolution_instance,
      request_id: pending.request_id,
      nav_request_id: navRequestId,
      device_id: pending.device_id,
      pairing_code: pending.pairing_code,
      message: "Pairing já enfileirado para esta navegação",
    };
  }

  if (pending.status === "fetching_code") {
    return {
      ok: false,
      error: "pairing_fetch_in_progress",
      nav_request_id: navRequestId,
    };
  }

  if (pending.status !== "awaiting_navigation") {
    return {
      ok: false,
      error: "pending_not_ready",
      status: pending.status,
      nav_request_id: navRequestId,
    };
  }

  const phone = String(pending.phone_e164 || "").replace(/\D/g, "");
  const instance = pending.evolution_instance;
  let pairingCode = pending.pairing_code;

  if (!pairingCode) {
    const obtained = await obtainPairingCode({
      device_id: pending.device_id,
      instance,
      phone,
      request_id: pending.request_id,
      nav_request_id: navRequestId,
      phone_e164: pending.phone_e164,
      force_new: false,
    });
    if (!obtained.ok) {
      pendingPairing.update(pending.id, {
        status: "failed",
        error: obtained.error || "pairing_failed",
      });
      return {
        ok: false,
        error: obtained.error || "pairing_failed",
        evolution_instance: instance,
        nav_request_id: navRequestId,
      };
    }
    pairingCode = obtained.pairing_code;
  }

  const dispatched = await enqueuePairingCode({
    device_id: pending.device_id,
    request_id: pending.request_id,
    instance,
    phone,
    pairingCode,
    wait_open_ms: pending.wait_open_ms || 0,
    connData: null,
    reused: Boolean(pending.pairing_code),
  });

  pendingPairing.update(pending.id, {
    status: "pairing_queued",
    pairing_code: pairingCode,
  });

  return {
    ok: true,
    phase: "pairing_queued",
    evolution_instance: instance,
    phone_e164: pending.phone_e164,
    request_id: pending.request_id,
    nav_request_id: navRequestId,
    device_id: pending.device_id,
    pairing_code: pairingCode,
    ...dispatched,
  };
}

/** Endpoint manual /pair — respeita código ativo salvo. */
async function pairInstanceToDevice({
  device_id,
  instance,
  phone_e164,
  request_id,
  force_new = false,
}) {
  const phone = String(phone_e164 || "").replace(/\D/g, "");
  const obtained = await obtainPairingCode({
    device_id,
    instance,
    phone,
    request_id,
    phone_e164: phone_e164?.trim(),
    force_new,
  });
  if (!obtained.ok) {
    return { ok: false, ...obtained };
  }

  const dispatched = await enqueuePairingCode({
    device_id,
    request_id,
    instance,
    phone,
    pairingCode: obtained.pairing_code,
    connData: obtained.connData,
    reused: obtained.reused,
  });

  return {
    ok: true,
    pairing_code: obtained.pairing_code,
    connection_state: dispatched.connection_state,
    reused: obtained.reused,
    expires_at: obtained.expires_at,
    ...dispatched,
  };
}

/** Após código rejeitado: apaga instância Evolution e limpa fila (WA será fechado no próximo link). */
async function resetAfterPairingFailure({ device_id, evolution_instance, reason }) {
  const instance = String(evolution_instance || "");
  const device = String(device_id || "");
  if (instance) {
    await evolution.logoutInstance(instance).catch(() => null);
    await evolution.deleteInstance(instance).catch(() => null);
    activePairing.clearForInstance(instance);
  }
  if (device) {
    deviceActions.cancelPending(device);
    activePairing.cancelForDevice(device);
  }
  const pending = pendingPairing.list?.() || [];
  const row = pending.find(
    (p) => p.device_id === device && p.evolution_instance === instance && p.status === "pairing_queued",
  );
  if (row?.id) {
    pendingPairing.update(row.id, { status: "failed", error: reason || "pairing_code_rejected" });
  }
  if (device) {
    slots.updateSlotByDevice(device, {
      evo_status: "close",
      pool_status: "offline",
      last_message:
        "Código rejeitado — instância apagada. Próximo link: force_new=true (fecha WA + recentes + código novo).",
    });
  }
  return { ok: true, instance_deleted: Boolean(instance), device_id: device };
}

module.exports = {
  linkWhatsappToEvolution,
  dispatchOpenAfterForceStop,
  dispatchPairingAfterHome,
  dispatchNavigationAfterHome,
  dispatchPairingAfterNavigation,
  pairInstanceToDevice,
  obtainPairingCode,
  resetAfterPairingFailure,
};
