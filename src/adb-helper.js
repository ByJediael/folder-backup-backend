/**
 * Force-stop WhatsApp via adb (confiável — mata processo em 1º e 2º plano).
 * Usa ADB_PATH ou Android SDK padrão no Windows.
 */
const { execFile } = require("child_process");
const path = require("path");
const os = require("os");

const WA_PKG = "com.whatsapp.w4b";
const A11Y_SERVICE =
  "com.folderbackup.agent/com.folderbackup.agent.registration.WhatsappRegistrationAccessibilityService";

function resolveAdbPath() {
  if (process.env.ADB_PATH) return process.env.ADB_PATH;
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "Android",
      "Sdk",
      "platform-tools",
      "adb.exe",
    );
  }
  return "adb";
}

function runAdb(args, { timeoutMs = 15_000 } = {}) {
  const adb = resolveAdbPath();
  return new Promise((resolve) => {
    execFile(adb, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        error: err?.message || null,
      });
    });
  });
}

/** @returns {Promise<{ ok: boolean, running: boolean, pid?: string }>} */
async function isWhatsappRunning(serial) {
  const base = serial ? ["-s", serial] : [];
  const res = await runAdb([
    ...base,
    "shell",
    "pidof",
    WA_PKG,
  ]);
  const pid = res.stdout.split(/\s+/).filter(Boolean)[0] || "";
  return { ok: res.ok, running: pid.length > 0, pid: pid || undefined };
}

/**
 * Force-stop agressivo + remove dos apps recentes + verificação.
 * @param {string} [serial] — adb serial; omitir = device padrão
 */
async function dismissWhatsappFromRecents(serial) {
  const base = serial ? ["-s", serial] : [];
  await runAdb([...base, "shell", "input", "keyevent", "3"]);
  await new Promise((r) => setTimeout(r, 400));
  // Botão quadrado — lista de apps recentes
  await runAdb([...base, "shell", "input", "keyevent", "187"]);
  await new Promise((r) => setTimeout(r, 1200));
  // Botão X no canto do card (Samsung 720p)
  await runAdb([...base, "shell", "input", "tap", "670", "320"]);
  await new Promise((r) => setTimeout(r, 500));
  // Arrastar card para o lado (Samsung)
  await runAdb([...base, "shell", "input", "swipe", "520", "560", "20", "560", "280"]);
  await new Promise((r) => setTimeout(r, 450));
  // Arrastar card para cima (fallback)
  await runAdb([...base, "shell", "input", "swipe", "360", "750", "360", "120", "300"]);
  await new Promise((r) => setTimeout(r, 400));
  await runAdb([...base, "shell", "input", "keyevent", "3"]);
  return { ok: true };
}

async function forceStopWhatsapp(serial) {
  const base = serial ? ["-s", serial] : [];
  await dismissWhatsappFromRecents(serial).catch(() => null);
  const script =
    `am force-stop ${WA_PKG}; ` +
    `killall ${WA_PKG} 2>/dev/null || true; ` +
    `am force-stop ${WA_PKG}`;

  await runAdb([...base, "shell", script]);

  for (let i = 0; i < 4; i++) {
    const st = await isWhatsappRunning(serial);
    if (!st.running) {
      await dismissWhatsappFromRecents(serial).catch(() => null);
      return { ok: true, verified: true, attempts: i + 1, recents_cleared: true };
    }
    await runAdb([...base, "shell", `am force-stop ${WA_PKG}`]);
    await new Promise((r) => setTimeout(r, 600));
  }

  const final = await isWhatsappRunning(serial);
  return {
    ok: !final.running,
    verified: !final.running,
    still_running: final.running,
    pid: final.pid,
  };
}

/** Reativa acessibilidade após adb install (Android desliga o serviço). */
async function enableBackupAccessibility(serial) {
  const base = serial ? ["-s", serial] : [];
  await runAdb([
    ...base,
    "shell",
    "settings",
    "put",
    "secure",
    "enabled_accessibility_services",
    A11Y_SERVICE,
  ]);
  const enabled = await runAdb([
    ...base,
    "shell",
    "settings",
    "put",
    "secure",
    "accessibility_enabled",
    "1",
  ]);
  const check = await runAdb([
    ...base,
    "shell",
    "settings",
    "get",
    "secure",
    "enabled_accessibility_services",
  ]);
  const ok =
    enabled.ok &&
    check.stdout.includes("WhatsappRegistrationAccessibilityService");
  return { ok, enabled_services: check.stdout };
}

/** Digita pairing code via adb input text (Samsung G570M — a11y setText falha). */
async function typePairingCode(serial, code) {
  const chars = String(code || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8);
  if (chars.length < 8) {
    return { ok: false, error: "code_too_short", code: chars };
  }
  const base = serial ? ["-s", serial] : [];
  await runAdb([...base, "shell", "input", "tap", "71", "468"]);
  await new Promise((r) => setTimeout(r, 400));
  for (const ch of chars) {
    const res = await runAdb([...base, "shell", "input", "text", ch]);
    if (!res.ok) {
      return { ok: false, error: res.error || "input_failed", char: ch };
    }
    await new Promise((r) => setTimeout(r, 280));
  }
  return { ok: true, code: chars };
}

/** Fallback: OK em alerta modal anti-golpe (720p Samsung). */
async function tapScamOkButton(serial) {
  const base = serial ? ["-s", serial] : [];
  await runAdb([...base, "shell", "input", "tap", "360", "980"]);
  return { ok: true };
}

/** Fallback: toque no botão inferior da tela anti-golpe (720p Samsung). */
async function tapScamConnectButton(serial) {
  const base = serial ? ["-s", serial] : [];
  await runAdb([...base, "shell", "input", "tap", "360", "1180"]);
  await new Promise((r) => setTimeout(r, 400));
  await runAdb([...base, "shell", "input", "tap", "360", "1180"]);
  return { ok: true };
}

module.exports = {
  WA_PKG,
  resolveAdbPath,
  forceStopWhatsapp,
  dismissWhatsappFromRecents,
  isWhatsappRunning,
  enableBackupAccessibility,
  typePairingCode,
  tapScamOkButton,
  tapScamConnectButton,
};
