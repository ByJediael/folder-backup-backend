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
 * Preferência: arrastar card para cima (Motorola / Android moderno).
 * @param {string} [serial] — adb serial; omitir = device padrão
 */
async function dismissWhatsappFromRecents(serial) {
  const base = serial ? ["-s", serial] : [];
  const sizeRes = await runAdb([...base, "shell", "wm", "size"]);
  const match = String(sizeRes.stdout || "").match(/(\d+)x(\d+)/);
  const width = Number(match?.[1] || 1080);
  const height = Number(match?.[2] || 2400);
  const cx = Math.round(width / 2);
  const yStart = Math.round(height * 0.72);
  const yEnd = Math.round(height * 0.08);

  await runAdb([...base, "shell", "input", "keyevent", "3"]);
  await new Promise((r) => setTimeout(r, 400));
  // Botão quadrado / recentes
  await runAdb([...base, "shell", "input", "keyevent", "187"]);
  await new Promise((r) => setTimeout(r, 1200));
  // 1) Arrastar para cima (Moto / gesture)
  await runAdb([
    ...base,
    "shell",
    "input",
    "swipe",
    String(cx),
    String(yStart),
    String(cx),
    String(yEnd),
    "380",
  ]);
  await new Promise((r) => setTimeout(r, 500));
  // 2) Segunda passada no card
  await runAdb([
    ...base,
    "shell",
    "input",
    "swipe",
    String(cx),
    String(Math.round(height * 0.65)),
    String(cx),
    String(Math.round(height * 0.05)),
    "350",
  ]);
  await new Promise((r) => setTimeout(r, 400));
  // 3) Fallback lateral (Samsung antigo)
  await runAdb([
    ...base,
    "shell",
    "input",
    "swipe",
    String(Math.round(width * 0.75)),
    String(Math.round(height * 0.55)),
    String(Math.round(width * 0.05)),
    String(Math.round(height * 0.55)),
    "280",
  ]);
  await new Promise((r) => setTimeout(r, 400));
  await runAdb([...base, "shell", "input", "keyevent", "3"]);
  return { ok: true, width, height };
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

/** Lista devices `adb devices -l`. */
async function listDevices() {
  const res = await runAdb(["devices", "-l"]);
  const lines = res.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const devices = lines
    .map((line) => {
      const parts = line.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] || "";
      const model = (line.match(/model:(\S+)/) || [])[1] || null;
      return { serial, state, model, line };
    })
    .filter((d) => d.serial);
  return { ok: res.ok, devices, raw: res.stdout };
}

/** `adb reverse tcp:LOCAL tcp:DEVICE` — APK local → PC :8080. */
async function reversePort(localPort = 8080, devicePort = 8080, serial) {
  const base = serial ? ["-s", serial] : [];
  const res = await runAdb([
    ...base,
    "reverse",
    `tcp:${Number(localPort)}`,
    `tcp:${Number(devicePort)}`,
  ]);
  return { ok: res.ok, localPort, devicePort, stdout: res.stdout, error: res.error };
}

/** Abre WhatsApp Business (launcher). */
async function openWhatsapp(serial) {
  const base = serial ? ["-s", serial] : [];
  const res = await runAdb([
    ...base,
    "shell",
    "monkey",
    "-p",
    WA_PKG,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
  return { ok: res.ok, stdout: res.stdout, error: res.error };
}

/** Abre o Folder Backup Agent. */
async function openBackupAgent(serial) {
  const base = serial ? ["-s", serial] : [];
  const res = await runAdb([
    ...base,
    "shell",
    "am",
    "start",
    "-n",
    "com.folderbackup.agent/.MainActivity",
  ]);
  return { ok: res.ok, stdout: res.stdout, error: res.error };
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
  listDevices,
  reversePort,
  openWhatsapp,
  openBackupAgent,
};
