#!/usr/bin/env node
/**
 * Dispara pairing Evolution via a central (:8080).
 *
 * Uso:
 *   node scripts/link-evolution.js
 *   node scripts/link-evolution.js --device-id=dev-1fe4ffc0 --phone=+573159397209
 *   node scripts/link-evolution.js --force-new
 *
 * Env: BASE_URL, BACKUP_API_TOKEN, DEVICE_ID, PHONE_E164, EVOLUTION_INSTANCE
 */
const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const TOKEN = process.env.BACKUP_API_TOKEN || "12345678";

function arg(name, fallback) {
  const flag = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(flag));
  if (hit) return hit.slice(flag.length);
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

async function main() {
  const body = {
    device_id: arg("device-id", process.env.DEVICE_ID || "dev-1fe4ffc0"),
    phone_e164: arg("phone", process.env.PHONE_E164 || "+573159397209"),
    evolution_instance:
      arg("instance", process.env.EVOLUTION_INSTANCE || "wa-co-3159397209"),
    navigate_first: arg("navigate-first", "true") !== "false",
    force_new: Boolean(arg("force-new", false)) || process.argv.includes("--force-new"),
  };

  const url = `${BASE_URL}/api/v1/admin/whatsapp/link-evolution`;
  console.log("POST", url);
  console.log(JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  console.log("STATUS", res.status);
  console.log(JSON.stringify(json, null, 2));
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
