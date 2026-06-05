const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { notifyN8n, isConfigured } = require("./n8n");
const { appendEvent, readEvents } = require("./events");
const slots = require("./slots");
const evolution = require("./evolution");
const {
  saveFcmToken,
  sendSyncPush,
  sendSwitchSessionPush,
  sendClearSessionPush,
  sendRegisterWhatsappPush,
  sendSubmitRegistrationCodePush,
  sendExportSessionPush,
  sendSubmitPairingCodePush,
  sendMacroHomePush,
  sendMacroOpenWhatsappPush,
  fcmStatus,
} = require("./fcm");
const { getStatus, setDispatched, updateFromDevice } = require("./whatsapp-switch");
const {
  getRegisterStatus,
  setRegisterDispatched,
  updateRegisterFromDevice,
} = require("./whatsapp-register");

const EVOLUTION_WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET || "";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.BACKUP_API_TOKEN || "dev-token-change-me";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (!fs.existsSync(JOBS_FILE)) {
  fs.writeFileSync(JOBS_FILE, "[]", "utf8");
}

const upload = multer({ dest: UPLOADS_DIR });
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));

function readJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeJobs(jobs) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf8");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  if (header !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function logEvent(event, payload = {}) {
  const slot =
    (payload.device_id && slots.findByDeviceId(payload.device_id)) ||
    (payload.evolution_instance && slots.findByEvolutionInstance(payload.evolution_instance)) ||
    (payload.slot_id && slots.findBySlotId(payload.slot_id)) ||
    null;

  appendEvent({
    event,
    slot_id: slot?.slot_id ?? payload.slot_id,
    device_id: payload.device_id ?? slot?.device_id,
    evolution_instance: payload.evolution_instance ?? slot?.evolution_instance,
    message: payload.message ?? payload.status ?? null,
    ...payload,
  });

  notifyN8n(event, {
    slot_id: slot?.slot_id,
    device_id: payload.device_id ?? slot?.device_id,
    session_label: slot?.session_label,
    evolution_instance: payload.evolution_instance ?? slot?.evolution_instance,
    evo_status: payload.evo_status ?? slot?.evo_status,
    ...payload,
  }).catch(() => {});
}

app.get("/api/v1/health", auth, (_req, res) => {
  res.json({
    status: "ok",
    service: "folder-backup-backend",
    n8n_webhooks: isConfigured(),
    fcm: fcmStatus(),
    evolution: evolution.statusInfo(),
    public_base_url: PUBLIC_BASE_URL,
  });
});

app.get("/api/v1/dashboard", auth, async (_req, res) => {
  const enriched = slots.listSlotsEnriched();
  let evoInstances = [];
  if (evolution.isEnabled()) {
    const evo = await evolution.fetchInstances();
    if (evo.ok) evoInstances = evo.instances;
  }
  res.json({
    slots: enriched,
    events: readEvents({ limit: 30 }),
    fcm: fcmStatus(),
    evolution: { ...evolution.statusInfo(), instances: evoInstances },
    n8n_configured: isConfigured(),
  });
});

app.get("/api/v1/admin/slots", auth, (_req, res) => {
  res.json({ slots: slots.listSlotsEnriched() });
});

app.put("/api/v1/admin/slots/:slotId", auth, (req, res) => {
  const slotId = req.params.slotId;
  const existing = slots.findBySlotId(slotId);
  if (!existing) {
    return res.status(404).json({ error: "slot não encontrado" });
  }
  const updated = slots.upsertSlot({
    ...existing,
    ...req.body,
    slot_id: slotId,
  });
  logEvent("slot_updated", { slot_id: slotId, device_id: updated.device_id });
  res.json({ ok: true, slot: slots.enrichSlot(updated) });
});

app.post("/api/v1/admin/slots", auth, (req, res) => {
  const slot_id = req.body?.slot_id || `slot-${crypto.randomUUID().slice(0, 6)}`;
  const created = slots.upsertSlot({ ...req.body, slot_id });
  logEvent("slot_created", { slot_id, device_id: created.device_id });
  res.status(201).json({ ok: true, slot: slots.enrichSlot(created) });
});

app.get("/api/v1/events", auth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const slot_id = req.query.slot_id;
  const device_id = req.query.device_id;
  res.json({
    events: readEvents({ limit, slot_id, device_id }),
  });
});

app.put("/api/v1/devices/:deviceId/fcm-token", auth, (req, res) => {
  const deviceId = req.params.deviceId;
  const fcmToken = req.body?.fcm_token;
  if (!fcmToken || typeof fcmToken !== "string") {
    return res.status(400).json({ error: "fcm_token obrigatório" });
  }
  saveFcmToken(deviceId, fcmToken.trim());
  const slot = slots.findByDeviceId(deviceId);
  if (slot) {
    slots.upsertSlot({
      ...slot,
      last_message: "FCM registrado",
      phone_status: "idle",
    });
  }
  logEvent("fcm_registered", { device_id: deviceId, slot_id: slot?.slot_id });
  res.json({ ok: true, device_id: deviceId });
});

app.get("/api/v1/devices/:deviceId/commands", auth, (req, res) => {
  const deviceId = req.params.deviceId;
  const jobs = readJobs();
  const pending = jobs.filter(
    (j) => j.device_id === deviceId && j.status === "pending",
  );

  const commands = pending.map((j) => ({
    id: j.id,
    type: j.type,
    folder_id: j.folder_id || undefined,
    folder_uri: j.folder_uri || undefined,
    absolute_path: j.absolute_path || undefined,
    backup_id: j.backup_id || undefined,
    incremental: j.incremental !== false,
  }));

  const remaining = jobs.filter(
    (j) => !(j.device_id === deviceId && j.status === "pending"),
  );
  const dispatched = pending.map((j) => ({
    ...j,
    status: "dispatched",
    dispatched_at: new Date().toISOString(),
  }));
  writeJobs([...remaining, ...dispatched]);

  res.json({ commands });
});

app.post("/api/v1/upload", auth, upload.single("file"), (req, res) => {
  const meta = {
    job_id: req.body.job_id,
    folder_id: req.body.folder_id,
    relative_path: req.body.relative_path,
    sha256: req.body.sha256,
    size_bytes: req.body.size_bytes,
    last_modified: req.body.last_modified,
    received_at: new Date().toISOString(),
  };

  if (req.file && meta.relative_path) {
    const safeName = meta.relative_path.replace(/\.\./g, "_").replace(/\//g, "__");
    const finalPath = path.join(UPLOADS_DIR, meta.job_id || "unknown", safeName);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(req.file.path, finalPath);
    meta.stored_path = finalPath;
  }

  const logPath = path.join(UPLOADS_DIR, `${meta.job_id || "job"}-manifest.jsonl`);
  fs.appendFileSync(logPath, JSON.stringify(meta) + "\n", "utf8");

  notifyN8n("file_uploaded", meta);

  res.json({ ok: true });
});

app.post("/api/v1/jobs/:jobId/progress", auth, (req, res) => {
  const jobId = req.params.jobId;
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  const progress = { ...req.body, at: new Date().toISOString() };

  if (idx >= 0) {
    jobs[idx] = {
      ...jobs[idx],
      last_progress: progress,
      status:
        req.body.status === "completed"
          ? "completed"
          : req.body.status === "failed"
            ? "failed"
            : jobs[idx].status,
    };
    writeJobs(jobs);
    notifyN8n("job_progress", { job_id: jobId, job: jobs[idx], progress });
  } else {
    notifyN8n("job_progress", { job_id: jobId, progress, orphan: true });
  }

  res.json({ ok: true });
});

app.post("/api/v1/admin/jobs", auth, (req, res) => {
  const {
    device_id,
    type = "BACKUP",
    folder_id,
    folder_uri,
    absolute_path,
    backup_id,
    incremental = true,
  } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!["BACKUP", "RESTORE"].includes(type)) {
    return res.status(400).json({ error: "type deve ser BACKUP ou RESTORE" });
  }

  const job = {
    id: `job-${crypto.randomUUID().slice(0, 8)}`,
    device_id,
    type,
    folder_id: folder_id || null,
    folder_uri: folder_uri || null,
    absolute_path: absolute_path || null,
    backup_id: backup_id || null,
    incremental: Boolean(incremental),
    status: "pending",
    created_at: new Date().toISOString(),
  };

  const jobs = readJobs();
  jobs.push(job);
  writeJobs(jobs);

  notifyN8n("job_created", { job });

  sendSyncPush(device_id).then((push) => {
    if (push.ok) {
      console.log(`  fcm: sync push enviado para ${device_id} (${push.messageId})`);
    } else if (!push.skipped) {
      console.warn(`  fcm: falha para ${device_id}:`, push.error || push.reason);
    }
  });

  res.status(201).json({ ok: true, job });
});

app.get("/api/v1/admin/jobs", auth, (_req, res) => {
  res.json({ jobs: readJobs() });
});

/** Central de controle */
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "control.html"));
});

app.get("/switch", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "switch.html"));
});

app.get("/mount", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "mount.html"));
});

/** Troca sessão WhatsApp no celular via FCM (para vídeo / n8n). */
app.post("/api/v1/admin/whatsapp/switch", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const session_label = req.body?.session_label;
  const session_folder = req.body?.session_folder;
  const open_whatsapp = req.body?.open_whatsapp !== false;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!session_label || typeof session_label !== "string") {
    return res.status(400).json({ error: "session_label obrigatório (ex: numero-timv2)" });
  }

  const request_id = `sw-${crypto.randomUUID().slice(0, 8)}`;
  setDispatched(device_id, request_id, session_label.trim());

  const push = await sendSwitchSessionPush(
    device_id,
    session_label.trim(),
    request_id,
    open_whatsapp,
    session_folder?.trim() || null,
  );

  slots.updateSlotByDevice(device_id, {
    phone_status: "dispatched",
    last_message: `Troca ${session_label} enviada`,
    session_label: session_label.trim(),
  });
  logEvent("whatsapp_switch_requested", {
    device_id,
    session_label,
    request_id,
    fcm_ok: push.ok,
  });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    request_id,
    device_id,
    session_label,
    fcm_ok: push.ok,
    fcm_message_id: push.messageId ?? null,
    fcm_error: push.error ?? null,
    fcm_reason: push.reason ?? null,
  });
});

app.post("/api/v1/admin/whatsapp/clear", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }

  const request_id = `sw-${crypto.randomUUID().slice(0, 8)}`;
  setDispatched(device_id, request_id, "(limpar sessão)");

  const push = await sendClearSessionPush(device_id, request_id);

  slots.updateSlotByDevice(device_id, {
    phone_status: "dispatched",
    last_message: "Limpar sessão enviado",
  });
  logEvent("whatsapp_clear_requested", { device_id, request_id, fcm_ok: push.ok });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    request_id,
    device_id,
    action: "clear_session",
    fcm_ok: push.ok,
    fcm_message_id: push.messageId ?? null,
    fcm_error: push.error ?? null,
    fcm_reason: push.reason ?? null,
  });
});

app.get("/api/v1/admin/whatsapp/status", auth, (req, res) => {
  const device_id = req.query.device_id;
  if (!device_id) {
    return res.status(400).json({ error: "device_id query obrigatório" });
  }
  res.json(getStatus(String(device_id)));
});

app.post("/api/v1/devices/:deviceId/whatsapp/switch-status", auth, (req, res) => {
  const deviceId = req.params.deviceId;
  const updated = updateFromDevice(deviceId, {
    request_id: req.body?.request_id,
    session_label: req.body?.session_label,
    status: req.body?.status,
    message: req.body?.message,
  });
  slots.updateSlotByDevice(deviceId, {
    phone_status: updated.status,
    last_message: updated.message,
    session_label: updated.session_label || undefined,
  });
  logEvent("whatsapp_switch_status", updated);
  res.json({ ok: true, status: updated });
});

function fcmResponse(push) {
  return {
    fcm_ok: push.ok,
    fcm_message_id: push.messageId ?? null,
    fcm_error: push.error ?? null,
    fcm_reason: push.reason ?? null,
  };
}

/** Documenta / registra início de montagem fábrica (orquestração principal no n8n). */
app.post("/api/v1/admin/whatsapp/mount/start", auth, (req, res) => {
  const payload = {
    device_id: req.body?.device_id,
    session_label: req.body?.session_label,
    evolution_instance: req.body?.evolution_instance,
    phone_e164: req.body?.phone_e164,
    n8n_workflow: "wa-montagem-factory.json",
  };
  logEvent("wa_mount_step", { step: "start", ...payload });
  res.json({
    ok: true,
    message: "Montagem: importe wa-montagem-factory.json no n8n ou use /mount para passos manuais",
    steps: [
      "clear",
      "register + Hero SMS",
      "register-code",
      "evolution pair (pairing code + FCM)",
      "aguardar Evolution open",
      "export (opcional)",
      "clear (celular livre; Evolution permanece na VPS)",
    ],
    ...payload,
  });
});

/** Macro: ir para tela inicial (HOME) — orquestrado pelo n8n com Wait após. */
app.post("/api/v1/admin/whatsapp/macro/home", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const request_id = req.body?.request_id || `macro-${crypto.randomUUID().slice(0, 8)}`;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }

  const push = await sendMacroHomePush(device_id, request_id);
  logEvent("wa_macro_step", {
    step: "home",
    device_id,
    request_id,
    ...fcmResponse(push),
  });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    step: "home",
    request_id,
    device_id,
    ...fcmResponse(push),
  });
});

/** Macro: abrir WhatsApp pelo launcher (estilo pessoa) — após macro/home + Wait no n8n. */
app.post("/api/v1/admin/whatsapp/macro/open-whatsapp", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const request_id = req.body?.request_id || `macro-${crypto.randomUUID().slice(0, 8)}`;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }

  const push = await sendMacroOpenWhatsappPush(device_id, request_id);
  logEvent("wa_macro_step", {
    step: "open_whatsapp",
    device_id,
    request_id,
    ...fcmResponse(push),
  });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    step: "open_whatsapp",
    request_id,
    device_id,
    ...fcmResponse(push),
  });
});

/** Inicia cadastro WA no celular (Hero SMS → n8n → FCM). */
app.post("/api/v1/admin/whatsapp/register", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const phone_e164 = req.body?.phone_e164;
  const session_label = req.body?.session_label;
  const display_name = req.body?.display_name;
  const request_id = req.body?.request_id || `reg-${crypto.randomUUID().slice(0, 8)}`;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!phone_e164 || typeof phone_e164 !== "string") {
    return res.status(400).json({ error: "phone_e164 obrigatório" });
  }
  if (!session_label || typeof session_label !== "string") {
    return res.status(400).json({ error: "session_label obrigatório" });
  }

  setRegisterDispatched(device_id, request_id, {
    command: "register_whatsapp",
    session_label: session_label.trim(),
    phone_e164: phone_e164.trim(),
    message: `Cadastro iniciado — ${phone_e164.trim()}`,
  });

  const push = await sendRegisterWhatsappPush(
    device_id,
    request_id,
    phone_e164.trim(),
    session_label.trim(),
    display_name?.trim() || null,
  );

  slots.updateSlotByDevice(device_id, {
    phone_status: "dispatched",
    last_message: `Cadastro ${phone_e164.trim()}`,
    phone_e164: phone_e164.trim(),
    session_label: session_label.trim(),
  });
  logEvent("wa_register_requested", {
    device_id,
    request_id,
    phone_e164,
    session_label,
    ...fcmResponse(push),
  });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    request_id,
    device_id,
    phone_e164,
    session_label,
    ...fcmResponse(push),
  });
});

/** Envia código SMS ao celular (n8n recebeu OTP da Hero SMS). */
app.post("/api/v1/admin/whatsapp/register-code", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const code = req.body?.code;
  const request_id = req.body?.request_id;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!code) {
    return res.status(400).json({ error: "code obrigatório" });
  }
  if (!request_id || typeof request_id !== "string") {
    return res.status(400).json({ error: "request_id obrigatório" });
  }

  const push = await sendSubmitRegistrationCodePush(device_id, request_id, code);

  logEvent("wa_register_code_sent", {
    device_id,
    request_id,
    ...fcmResponse(push),
  });

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    request_id,
    device_id,
    ...fcmResponse(push),
  });
});

/** Exporta sessão WA no celular via FCM. */
app.post("/api/v1/admin/whatsapp/export", auth, async (req, res) => {
  const device_id = req.body?.device_id;
  const session_label = req.body?.session_label;
  const request_id = req.body?.request_id || `exp-${crypto.randomUUID().slice(0, 8)}`;

  if (!device_id || typeof device_id !== "string") {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!session_label || typeof session_label !== "string") {
    return res.status(400).json({ error: "session_label obrigatório" });
  }

  setRegisterDispatched(device_id, request_id, {
    command: "export_session",
    session_label: session_label.trim(),
    message: `Exportando sessão ${session_label.trim()}`,
  });

  const push = await sendExportSessionPush(device_id, request_id, session_label.trim());

  res.status(push.ok ? 200 : 502).json({
    ok: push.ok,
    request_id,
    device_id,
    session_label,
    ...fcmResponse(push),
  });
});

app.get("/api/v1/admin/whatsapp/register-status", auth, (req, res) => {
  const device_id = req.query.device_id;
  if (!device_id) {
    return res.status(400).json({ error: "device_id query obrigatório" });
  }
  res.json(getRegisterStatus(String(device_id)));
});

/** Resultado genérico do celular (cadastro, export, etc.). */
app.post("/api/v1/devices/:deviceId/command-result", auth, (req, res) => {
  const deviceId = req.params.deviceId;
  const updated = updateRegisterFromDevice(deviceId, {
    request_id: req.body?.request_id,
    command: req.body?.command,
    session_label: req.body?.session_label,
    phone_e164: req.body?.phone_e164,
    status: req.body?.status,
    message: req.body?.message,
  });
  slots.updateSlotByDevice(deviceId, {
    phone_status: updated.status,
    last_message: updated.message,
    session_label: updated.session_label || undefined,
    phone_e164: updated.phone_e164 || undefined,
  });
  logEvent("wa_register_status", updated);
  res.json({ ok: true, status: updated });
});

/** Evolution API proxy */
app.get("/api/v1/evolution/instances", auth, async (_req, res) => {
  const result = await evolution.fetchInstances();
  if (!result.ok) {
    return res.status(result.status === undefined ? 503 : result.status).json(result);
  }
  res.json({ ok: true, instances: result.instances });
});

app.get("/api/v1/evolution/instances/:name/qr", auth, async (req, res) => {
  const name = req.params.name;
  const conn = await evolution.connectInstance(name);
  if (!conn.ok) {
    return res.status(conn.status || 502).json(conn);
  }
  const qr = evolution.extractQrBase64(conn.data);
  const state = evolution.mapConnectionState(conn.data);
  slots.updateSlotByEvolution(name, { evo_status: state === "open" ? "open" : "qr" });
  res.json({
    ok: true,
    instance: name,
    connection_state: state,
    qr_base64: qr,
    raw: conn.data,
  });
});

app.get("/api/v1/evolution/instances/:name/state", auth, async (req, res) => {
  const name = req.params.name;
  const st = await evolution.connectionState(name);
  if (!st.ok) {
    return res.status(st.status || 502).json(st);
  }
  const mapped = evolution.mapConnectionState(st.data);
  slots.updateSlotByEvolution(name, {
    evo_status: mapped,
    last_message: `Evolution: ${mapped}`,
  });
  res.json({ ok: true, instance: name, state: mapped, raw: st.data });
});

/** Pairing code Evolution + FCM para celular fábrica digitar no WA */
app.post("/api/v1/evolution/instances/:name/pair", auth, async (req, res) => {
  const name = req.params.name;
  const device_id = req.body?.device_id;
  const phone_e164 = req.body?.phone_e164;
  const request_id = req.body?.request_id || `pair-${crypto.randomUUID().slice(0, 8)}`;
  const create_if_missing = req.body?.create_if_missing !== false;

  if (!device_id) {
    return res.status(400).json({ error: "device_id obrigatório" });
  }
  if (!phone_e164) {
    return res.status(400).json({ error: "phone_e164 obrigatório" });
  }

  if (create_if_missing) {
    const created = await evolution.createInstance(name);
    if (!created.ok && created.status !== 409) {
      console.warn("[evolution] create instance:", created.error || created.status);
    }
  }

  const conn = await evolution.connectWithPairing(name, phone_e164);
  if (!conn.ok) {
    return res.status(conn.status || 502).json(conn);
  }

  const pairingCode = evolution.extractPairingCode(conn.data);
  const state = evolution.mapConnectionState(conn.data);

  slots.updateSlotByEvolution(name, {
    evo_status: state === "open" ? "open" : "qr",
    phone_e164: phone_e164.trim(),
    last_message: pairingCode ? `Pairing: ${pairingCode}` : "Aguardando pairing",
  });

  let fcmPush = { ok: false, skipped: true, reason: "no_pairing_code" };
  if (pairingCode) {
    fcmPush = await sendSubmitPairingCodePush(
      device_id,
      request_id,
      pairingCode,
      name,
    );
  }

  logEvent("evo_pairing_code", {
    device_id,
    request_id,
    evolution_instance: name,
    phone_e164,
    pairing_code: pairingCode,
    connection_state: state,
    fcm_ok: fcmPush.ok,
    fcm_error: fcmPush.error ?? null,
  });

  res.status(pairingCode && fcmPush.ok ? 200 : pairingCode ? 502 : 200).json({
    ok: Boolean(pairingCode),
    instance: name,
    pairing_code: pairingCode,
    connection_state: state,
    request_id,
    device_id,
    fcm_ok: fcmPush.ok,
    fcm_message_id: fcmPush.messageId ?? null,
    fcm_error: fcmPush.error ?? null,
    raw: conn.data,
  });
});

/** Webhook Evolution → atualiza slot + n8n */
app.post("/api/v1/webhooks/evolution", (req, res) => {
  if (EVOLUTION_WEBHOOK_SECRET) {
    const secret = req.headers["x-evolution-secret"] || req.query.secret;
    if (secret !== EVOLUTION_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  const body = req.body || {};
  const instance =
    body.instance ||
    body.instanceName ||
    body.data?.instance ||
    body.data?.instanceName ||
    null;
  const eventName = body.event || body.type || "evolution_event";
  const stateRaw =
    body.data?.state ||
    body.state ||
    body.connection ||
    body.status ||
    "";
  const state = String(stateRaw).toLowerCase();
  let evo_status = "unknown";
  if (state === "open" || state === "connected") evo_status = "open";
  else if (state === "close" || state === "closed" || state === "disconnected") evo_status = "close";
  else if (state.includes("qr") || eventName.includes("qrcode")) evo_status = "qr";

  if (instance) {
    slots.updateSlotByEvolution(instance, {
      evo_status,
      last_message: `Evolution ${eventName}: ${stateRaw || evo_status}`,
    });
  }

  if (evo_status === "open") {
    logEvent("evo_connected", {
      evolution_instance: instance,
      evo_status,
      evolution_payload: body,
    });
  }

  const n8nEvent = evo_status === "close" ? "evo_disconnected" : "evo_connection_update";
  logEvent(n8nEvent, {
    evolution_instance: instance,
    evo_status,
    evolution_payload: body,
  });

  res.json({ ok: true });
});

/** Dispara evento de teste no webhook n8n configurado */
app.post("/api/v1/admin/n8n/test", auth, async (_req, res) => {
  const configured = isConfigured();
  if (!configured) {
    return res.status(503).json({
      ok: false,
      backend: "ok",
      n8n_configured: false,
      n8n_ok: false,
      error: "N8N_WEBHOOK_URL não definido",
    });
  }

  const n8n = await notifyN8n("test", { message: "folder-backup-backend ping" });
  res.status(n8n.ok ? 200 : 502).json({
    ok: n8n.ok,
    backend: "ok",
    n8n_configured: true,
    n8n_ok: n8n.ok,
    n8n_status: n8n.status ?? null,
    error: n8n.error ?? null,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("folder-backup-backend");
  console.log(`  listen:  http://0.0.0.0:${PORT}`);
  console.log(`  celular: ${PUBLIC_BASE_URL}  (mesma rede Wi-Fi, sem /webhook)`);
  console.log(`  data:    ${DATA_DIR}`);
  console.log(`  n8n:     ${isConfigured() ? "webhooks ativos" : "N8N_WEBHOOK_URL não definido"}`);
  const fcm = fcmStatus();
  console.log(
    `  fcm:     ${fcm.enabled ? (fcm.initialized ? "ativo" : `erro: ${fcm.error}`) : "desativado (defina FIREBASE_SERVICE_ACCOUNT_PATH)"}`,
  );
  console.log(`  auth:    Authorization: Bearer <BACKUP_API_TOKEN>`);
  console.log(`  central: http://127.0.0.1:${PORT}/  (6 slots)`);
  console.log(`  legado:  http://127.0.0.1:${PORT}/switch`);
});
