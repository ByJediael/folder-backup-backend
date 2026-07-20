/**
 * Fila de remonta: HeroSMS → clear → register → SMS → code → Evolution pair → online.
 * Um job ativo por device_id (lock).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const slots = require("./slots");
const heroSms = require("./hero-sms");
const evolution = require("./evolution");
const {
  sendClearSessionPush,
  sendRegisterWhatsappPush,
  sendSubmitRegistrationCodePush,
  sendSubmitPairingCodePush,
} = require("./fcm");
const { setRegisterDispatched, getRegisterStatus } = require("./whatsapp-register");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const QUEUE_FILE = path.join(DATA_DIR, "remount-queue.json");
const POOL_ONLINE_BUFFER = Math.max(0, Number(process.env.POOL_ONLINE_BUFFER || 20));
const REMOUNT_AUTO_ENQUEUE = process.env.REMOUNT_AUTO_ENQUEUE === "true";
const SMS_WAIT_MS = Math.max(15000, Number(process.env.REMOUNT_SMS_WAIT_MS || 120000));
const CLEAR_WAIT_MS = Math.max(3000, Number(process.env.REMOUNT_CLEAR_WAIT_MS || 8000));
const OPEN_WAIT_MS = Math.max(15000, Number(process.env.REMOUNT_OPEN_WAIT_MS || 180000));

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readQueue() {
  ensureDataDir();
  if (!fs.existsSync(QUEUE_FILE)) {
    return { jobs: [], locks: {}, updated_at: null };
  }
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return { jobs: [], locks: {}, updated_at: null };
  }
}

function writeQueue(data) {
  ensureDataDir();
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function listJobs() {
  return readQueue().jobs || [];
}

function getLocks() {
  return readQueue().locks || {};
}

function isDeviceLocked(deviceId, data) {
  const locks = (data || readQueue()).locks || {};
  return Boolean(locks[deviceId]);
}

function lockDevice(data, deviceId, jobId) {
  data.locks = data.locks || {};
  data.locks[deviceId] = { job_id: jobId, locked_at: new Date().toISOString() };
}

function unlockDevice(data, deviceId) {
  if (data.locks) delete data.locks[deviceId];
}

function findJob(jobId) {
  return listJobs().find((j) => j.id === jobId) || null;
}

function updateJob(jobId, patch) {
  const data = readQueue();
  const idx = data.jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return null;
  data.jobs[idx] = {
    ...data.jobs[idx],
    ...patch,
    updated_at: new Date().toISOString(),
  };
  writeQueue(data);
  return data.jobs[idx];
}

function enqueue({ slot_id, device_id, reason } = {}) {
  let slot = slot_id ? slots.findBySlotId(slot_id) : null;
  if (!slot && device_id) slot = slots.findByDeviceId(device_id);
  if (!slot) {
    return { ok: false, error: "slot_not_found" };
  }
  if (!slot.device_id) {
    return { ok: false, error: "slot_sem_device_id" };
  }
  if (!slot.evolution_instance) {
    return { ok: false, error: "slot_sem_evolution_instance" };
  }

  const data = readQueue();
  const already = (data.jobs || []).find(
    (j) =>
      j.slot_id === slot.slot_id &&
      !["completed", "failed", "cancelled"].includes(j.status),
  );
  if (already) {
    return { ok: true, job: already, deduped: true };
  }

  const job = {
    id: `rm-${crypto.randomUUID().slice(0, 8)}`,
    slot_id: slot.slot_id,
    device_id: slot.device_id,
    evolution_instance: slot.evolution_instance,
    session_label: slot.session_label || `remount-${Date.now()}`,
    status: "pending",
    step: "queued",
    reason: reason || "manual",
    phone_e164: null,
    activation_id: null,
    request_id: null,
    pairing_code: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    step_started_at: null,
  };

  data.jobs = data.jobs || [];
  data.jobs.push(job);
  writeQueue(data);

  slots.upsertSlot({
    ...slot,
    pool_status: "remounting",
    in_pool: false,
    last_message: `Remonta enfileirada ${job.id}`,
  });

  return { ok: true, job };
}

function enqueueOfflineSlots() {
  const offline = slots.listSlots().filter(
    (s) =>
      s.device_id &&
      s.evolution_instance &&
      (s.pool_status === "offline" || (!s.pool_status && s.evo_status !== "open")),
  );
  const results = [];
  for (const s of offline) {
    results.push(enqueue({ slot_id: s.slot_id, reason: "offline" }));
  }
  return results;
}

function effectivePoolStatus(s) {
  if (s.pool_status) return s.pool_status;
  if (s.evo_status === "open" && s.phone_e164) return "online";
  return "offline";
}

function poolCounts() {
  const list = slots.listSlots();
  return {
    total: list.length,
    online: list.filter((s) => effectivePoolStatus(s) === "online").length,
    offline: list.filter((s) => effectivePoolStatus(s) === "offline").length,
    remounting: list.filter((s) => effectivePoolStatus(s) === "remounting").length,
    buffer_target: POOL_ONLINE_BUFFER,
  };
}

function maybeEnqueueForBuffer() {
  if (!REMOUNT_AUTO_ENQUEUE) {
    return { skipped: true, reason: "REMOUNT_AUTO_ENQUEUE not true" };
  }
  const counts = poolCounts();
  if (counts.online + counts.remounting >= POOL_ONLINE_BUFFER) {
    return { skipped: true, reason: "buffer_ok", counts };
  }
  const need = POOL_ONLINE_BUFFER - counts.online - counts.remounting;
  const candidates = slots.listSlots().filter(
    (s) =>
      s.device_id &&
      s.evolution_instance &&
      s.pool_status !== "online" &&
      s.pool_status !== "remounting",
  );
  const results = [];
  for (const s of candidates.slice(0, Math.max(0, need))) {
    results.push(enqueue({ slot_id: s.slot_id, reason: "buffer" }));
  }
  return { skipped: false, need, enqueued: results.length, results, counts };
}

function elapsed(job) {
  if (!job.step_started_at) return 0;
  return Date.now() - new Date(job.step_started_at).getTime();
}

async function advanceJob(job) {
  const slot = slots.findBySlotId(job.slot_id);
  if (!slot) {
    return updateJob(job.id, { status: "failed", step: "failed", error: "slot_missing" });
  }

  const setStep = (step, extra = {}) =>
    updateJob(job.id, {
      status: "running",
      step,
      step_started_at: new Date().toISOString(),
      ...extra,
    });

  try {
    if (job.status === "pending" || job.step === "queued") {
      const data = readQueue();
      if (isDeviceLocked(job.device_id, data)) {
        return job;
      }
      lockDevice(data, job.device_id, job.id);
      const idx = data.jobs.findIndex((j) => j.id === job.id);
      data.jobs[idx] = {
        ...data.jobs[idx],
        status: "running",
        step: "acquire_number",
        step_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      writeQueue(data);
      job = data.jobs[idx];
    }

    if (job.step === "acquire_number") {
      if (!heroSms.isConfigured()) {
        failJob(job, "hero_sms_not_configured");
        return findJob(job.id);
      }
      const num = await heroSms.getNumber();
      if (!num.ok) {
        failJob(job, num.error || "getNumber_failed");
        return findJob(job.id);
      }
      slots.upsertSlot({
        ...slot,
        pool_status: "remounting",
        phone_e164: num.phone_e164,
        last_message: `HeroSMS ${num.phone_e164}`,
        remount_count: (Number(slot.remount_count) || 0) + 1,
      });
      return setStep("clear_session", {
        phone_e164: num.phone_e164,
        activation_id: num.activation_id,
      });
    }

    if (job.step === "clear_session") {
      const request_id = `rm-clr-${crypto.randomUUID().slice(0, 6)}`;
      const push = await sendClearSessionPush(job.device_id, request_id);
      return setStep("wait_clear", {
        request_id,
        last_push_ok: push.ok,
        error: push.ok ? null : push.error || push.reason,
      });
    }

    if (job.step === "wait_clear") {
      if (elapsed(job) < CLEAR_WAIT_MS) return job;
      return setStep("register");
    }

    if (job.step === "register") {
      const request_id = `rm-reg-${crypto.randomUUID().slice(0, 6)}`;
      const phone = job.phone_e164;
      const session_label = job.session_label || `remount-${job.id}`;
      setRegisterDispatched(job.device_id, request_id, {
        command: "register_whatsapp",
        phone_e164: phone,
        session_label,
        message: "Remonta: cadastro enviado",
      });
      const push = await sendRegisterWhatsappPush(
        job.device_id,
        request_id,
        phone,
        session_label,
        "Conta Lead",
      );
      if (!push.ok) {
        failJob(job, push.error || push.reason || "fcm_register_failed");
        return findJob(job.id);
      }
      return setStep("wait_sms", { request_id, session_label });
    }

    if (job.step === "wait_sms") {
      if (!job.activation_id) {
        failJob(job, "missing_activation_id");
        return findJob(job.id);
      }
      const st = await heroSms.getStatus(job.activation_id);
      if (st.ok && st.ready && st.code) {
        return setStep("submit_code", { sms_code: st.code });
      }
      if (elapsed(job) > SMS_WAIT_MS) {
        if (job.activation_id) {
          await heroSms.setStatus(job.activation_id, 8).catch(() => {});
        }
        failJob(job, "sms_timeout");
        return findJob(job.id);
      }
      return job;
    }

    if (job.step === "submit_code") {
      const request_id = job.request_id || `rm-code-${crypto.randomUUID().slice(0, 6)}`;
      const push = await sendSubmitRegistrationCodePush(
        job.device_id,
        request_id,
        job.sms_code,
      );
      if (!push.ok) {
        failJob(job, push.error || push.reason || "fcm_code_failed");
        return findJob(job.id);
      }
      if (job.activation_id) {
        await heroSms.setStatus(job.activation_id, 6).catch(() => {});
      }
      return setStep("wait_register_done", { request_id });
    }

    if (job.step === "wait_register_done") {
      const reg = getRegisterStatus(job.device_id);
      if (reg?.status === "completed") {
        return setStep("pair_evolution");
      }
      if (reg?.status === "failed") {
        failJob(job, reg.message || "register_failed");
        return findJob(job.id);
      }
      if (elapsed(job) > SMS_WAIT_MS) {
        // segue para pairing mesmo assim — às vezes o APK não reporta
        return setStep("pair_evolution");
      }
      return job;
    }

    if (job.step === "pair_evolution") {
      const name = job.evolution_instance;
      const phone = job.phone_e164;
      await evolution.createInstance(name, phone).catch(() => {});
      const conn = await evolution.connectWithPairing(name, phone);
      const pairingCode = conn.ok ? evolution.extractPairingCode(conn.data) : null;
      if (!pairingCode) {
        failJob(job, conn.error || "pairing_code_missing");
        return findJob(job.id);
      }
      const request_id = `rm-pair-${crypto.randomUUID().slice(0, 6)}`;
      const push = await sendSubmitPairingCodePush(
        job.device_id,
        request_id,
        pairingCode,
        name,
      );
      const deviceActions = require("./device-actions");
      deviceActions.enqueue({
        device_id: job.device_id,
        action: "submit_pairing_code",
        request_id,
        pairing_code: pairingCode,
        evolution_instance: name,
        phone_e164: phone,
      });
      // FCM opcional — fila cobre o caso sem Firebase
      if (!push.ok && !push.skipped) {
        console.warn("[remount] FCM pairing falhou; ação na fila:", push.error || push.reason);
      }
      return setStep("wait_open", { pairing_code: pairingCode, request_id });
    }

    if (job.step === "wait_open") {
      const st = await evolution.connectionState(job.evolution_instance);
      const mapped = st.ok ? evolution.mapConnectionState(st.data) : "unknown";
      if (mapped === "open") {
        return completeJob(job);
      }
      if (elapsed(job) > OPEN_WAIT_MS) {
        failJob(job, "evolution_open_timeout");
        return findJob(job.id);
      }
      return job;
    }

    return job;
  } catch (err) {
    failJob(job, err.message || String(err));
    return findJob(job.id);
  }
}

function failJob(job, error) {
  const data = readQueue();
  const idx = data.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    data.jobs[idx] = {
      ...data.jobs[idx],
      status: "failed",
      step: "failed",
      error: String(error),
      updated_at: new Date().toISOString(),
    };
  }
  unlockDevice(data, job.device_id);
  writeQueue(data);

  const slot = slots.findBySlotId(job.slot_id);
  if (slot) {
    slots.upsertSlot({
      ...slot,
      pool_status: "offline",
      last_message: `Remonta falhou: ${error}`,
    });
  }
}

function completeJob(job) {
  const data = readQueue();
  const idx = data.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    data.jobs[idx] = {
      ...data.jobs[idx],
      status: "completed",
      step: "completed",
      error: null,
      updated_at: new Date().toISOString(),
    };
  }
  unlockDevice(data, job.device_id);
  writeQueue(data);

  const slot = slots.findBySlotId(job.slot_id);
  if (slot) {
    slots.upsertSlot({
      ...slot,
      pool_status: "online",
      in_pool: true,
      evo_status: "open",
      phone_e164: job.phone_e164 || slot.phone_e164,
      session_label: job.session_label || slot.session_label,
      last_message: "Remonta concluída — no pool",
      last_check: new Date().toISOString(),
    });
  }
  return findJob(job.id);
}

/**
 * Processa no máximo um job "novo" lock + avança todos running.
 */
async function processTick() {
  const buffer = maybeEnqueueForBuffer();
  const data = readQueue();
  const jobs = data.jobs || [];

  // Avança jobs running / pending cujo device está livre ou já locked por eles
  const active = jobs.filter((j) => !["completed", "failed", "cancelled"].includes(j.status));
  const results = [];

  // Preferir continuar jobs já locked
  const lockedJobIds = new Set(Object.values(data.locks || {}).map((l) => l.job_id));
  const ordered = [
    ...active.filter((j) => lockedJobIds.has(j.id)),
    ...active.filter((j) => !lockedJobIds.has(j.id)),
  ];

  // Um avanço por device por tick
  const seenDevices = new Set();
  for (const job of ordered) {
    if (seenDevices.has(job.device_id)) continue;
    // Se device locked por outro job, skip
    const lock = (data.locks || {})[job.device_id];
    if (lock && lock.job_id !== job.id) continue;
    seenDevices.add(job.device_id);
    results.push(await advanceJob(job));
  }

  return {
    processed: results.length,
    jobs: results,
    buffer,
    locks: getLocks(),
    pool: poolCounts(),
  };
}

function cancelJob(jobId) {
  const job = findJob(jobId);
  if (!job) return { ok: false, error: "not_found" };
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return { ok: true, job };
  }
  const data = readQueue();
  const idx = data.jobs.findIndex((j) => j.id === jobId);
  data.jobs[idx] = {
    ...data.jobs[idx],
    status: "cancelled",
    step: "cancelled",
    updated_at: new Date().toISOString(),
  };
  unlockDevice(data, job.device_id);
  writeQueue(data);
  const slot = slots.findBySlotId(job.slot_id);
  if (slot && slot.pool_status === "remounting") {
    slots.upsertSlot({
      ...slot,
      pool_status: "offline",
      last_message: "Remonta cancelada",
    });
  }
  return { ok: true, job: findJob(jobId) };
}

module.exports = {
  listJobs,
  getLocks,
  findJob,
  enqueue,
  enqueueOfflineSlots,
  processTick,
  cancelJob,
  poolCounts,
  maybeEnqueueForBuffer,
  POOL_ONLINE_BUFFER,
  REMOUNT_AUTO_ENQUEUE,
};
