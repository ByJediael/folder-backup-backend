/**
 * Lead router — rodízio de números online → wa.me + log de hits.
 */
const fs = require("fs");
const path = require("path");
const slots = require("./slots");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const STATE_FILE = path.join(DATA_DIR, "lead-router-state.json");
const HITS_FILE = path.join(DATA_DIR, "lead-hits.jsonl");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    return { rr_index: 0, updated_at: null };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { rr_index: 0, updated_at: null };
  }
}

function writeState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/** Slots elegíveis para o link: online no pool + telefone. */
function listRoutableSlots() {
  return slots.listSlots().filter((s) => {
    const status = s.pool_status || (s.evo_status === "open" ? "online" : "offline");
    const inPool = s.in_pool !== false;
    const phone = normalizePhone(s.phone_e164);
    return inPool && status === "online" && phone;
  });
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function waMeUrl(phoneDigits, text) {
  const base = `https://wa.me/${phoneDigits}`;
  if (text && String(text).trim()) {
    return `${base}?text=${encodeURIComponent(String(text).trim())}`;
  }
  return base;
}

function appendHit(hit) {
  ensureDataDir();
  fs.appendFileSync(HITS_FILE, JSON.stringify(hit) + "\n", "utf8");
}

/**
 * Escolhe próximo slot (rodízio) e registra hit.
 * @returns {{ ok: true, phone: string, slot: object, url: string, hit: object } | { ok: false, error: string }}
 */
function pickAndLog(campaign, meta = {}) {
  const routable = listRoutableSlots();
  if (routable.length === 0) {
    const miss = {
      at: new Date().toISOString(),
      campaign: String(campaign || "default"),
      ok: false,
      error: "no_online_numbers",
      ...meta,
    };
    appendHit(miss);
    return { ok: false, error: "no_online_numbers", hit: miss };
  }

  const state = readState();
  const idx = Math.abs(Number(state.rr_index) || 0) % routable.length;
  const slot = routable[idx];
  const phone = normalizePhone(slot.phone_e164);
  const url = waMeUrl(phone, meta.text);

  writeState({
    rr_index: idx + 1,
    updated_at: new Date().toISOString(),
    last_slot_id: slot.slot_id,
    last_phone: phone,
  });

  const hit = {
    at: new Date().toISOString(),
    campaign: String(campaign || "default"),
    ok: true,
    slot_id: slot.slot_id,
    evolution_instance: slot.evolution_instance || null,
    phone_e164: phone,
    device_id: slot.device_id || null,
    ...meta,
  };
  appendHit(hit);

  return { ok: true, phone, slot, url, hit };
}

function readHits({ limit = 100, campaign } = {}) {
  ensureDataDir();
  if (!fs.existsSync(HITS_FILE)) return [];
  const lines = fs.readFileSync(HITS_FILE, "utf8").split("\n").filter(Boolean);
  let rows = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  if (campaign) {
    rows = rows.filter((h) => h.campaign === campaign);
  }
  return rows.slice(-limit);
}

function countHitsSince(isoDate) {
  const since = isoDate ? new Date(isoDate).getTime() : 0;
  return readHits({ limit: 50000 }).filter((h) => {
    const t = new Date(h.at).getTime();
    return Number.isFinite(t) && t >= since;
  });
}

function metricsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const hits = countHitsSince(start.toISOString());
  const ok = hits.filter((h) => h.ok).length;
  const miss = hits.filter((h) => !h.ok).length;
  return {
    day: start.toISOString().slice(0, 10),
    hits_total: hits.length,
    hits_ok: ok,
    hits_miss: miss,
    redirect_ok_pct: hits.length ? Math.round((ok / hits.length) * 1000) / 10 : null,
  };
}

module.exports = {
  listRoutableSlots,
  pickAndLog,
  readHits,
  countHitsSince,
  metricsToday,
  normalizePhone,
  waMeUrl,
};
