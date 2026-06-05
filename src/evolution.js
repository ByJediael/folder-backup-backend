/**
 * Proxy para Evolution API — chave só no servidor.
 * @see https://doc.evolution-api.com/
 */

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";
const EVOLUTION_ENABLED = process.env.EVOLUTION_ENABLED !== "false" && Boolean(EVOLUTION_API_KEY);

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: EVOLUTION_API_KEY,
  };
}

function isEnabled() {
  return EVOLUTION_ENABLED;
}

function statusInfo() {
  return {
    enabled: EVOLUTION_ENABLED,
    base_url: EVOLUTION_BASE_URL,
    configured: Boolean(EVOLUTION_API_KEY),
  };
}

async function evolutionFetch(path, options = {}) {
  if (!EVOLUTION_ENABLED) {
    return { ok: false, error: "evolution_disabled" };
  }
  const url = `${EVOLUTION_BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers(), ...options.headers },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.message || text || `HTTP ${res.status}`, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function fetchInstances() {
  const result = await evolutionFetch("/instance/fetchInstances", { method: "GET" });
  if (!result.ok) return result;

  let instances = result.data;
  if (Array.isArray(instances)) {
    /* ok */
  } else if (Array.isArray(instances?.instances)) {
    instances = instances.instances;
  } else if (Array.isArray(instances?.response)) {
    instances = instances.response;
  } else {
    instances = [];
  }

  return { ok: true, instances };
}

async function connectInstance(instanceName) {
  return evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    method: "GET",
  });
}

/** POST /instance/connect com número → pairing code (sem QR). */
async function connectWithPairing(instanceName, phoneE164) {
  const digits = String(phoneE164 || "").replace(/\D/g, "");
  if (!digits) {
    return { ok: false, error: "phone_required" };
  }
  return evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      number: digits,
    }),
  });
}

async function createInstance(instanceName) {
  return evolutionFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: false,
      integration: "WHATSAPP-BAILEYS",
    }),
  });
}

async function connectionState(instanceName) {
  return evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
    method: "GET",
  });
}

function mapConnectionState(data) {
  const state =
    data?.instance?.state ||
    data?.state ||
    data?.status ||
    data?.connectionStatus ||
    "";
  const s = String(state).toLowerCase();
  if (s === "open" || s === "connected") return "open";
  if (s === "close" || s === "closed" || s === "disconnected") return "close";
  if (s.includes("qr") || s === "connecting") return "qr";
  return "unknown";
}

function extractQrBase64(data) {
  if (!data) return null;
  if (typeof data.base64 === "string") return data.base64;
  if (typeof data.qrcode?.base64 === "string") return data.qrcode.base64;
  if (typeof data.code === "string" && data.code.length > 100) return data.code;
  const root = data.qrcode || data;
  if (typeof root === "string" && root.length > 100) return root;
  return null;
}

function extractPairingCode(data) {
  if (!data) return null;
  const candidates = [
    data.pairingCode,
    data.pairing_code,
    data.qrcode?.pairingCode,
    data.qrcode?.pairing_code,
    data.code,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length >= 4 && c.length <= 12) {
      return c.replace(/\s/g, "").toUpperCase();
    }
  }
  return null;
}

function instanceNameFromRaw(inst) {
  if (!inst) return null;
  if (typeof inst === "string") return inst;
  return (
    inst.instanceName ||
    inst.name ||
    inst.instance?.instanceName ||
    inst.instance?.name ||
    null
  );
}

async function listInstancesOverview(slotsApi) {
  if (!EVOLUTION_ENABLED) {
    return { ok: true, enabled: false, instances: [], error: "evolution_disabled" };
  }
  const result = await fetchInstances();
  if (!result.ok) {
    return { ok: false, enabled: true, instances: [], error: result.error, status: result.status };
  }

  const rows = await Promise.all(
    (result.instances || []).map(async (inst) => {
      const name = instanceNameFromRaw(inst);
      if (!name) return null;
      const slot = slotsApi?.findByEvolutionInstance?.(name) || null;
      const st = await connectionState(name);
      const state = st.ok
        ? mapConnectionState(st.data)
        : slot?.evo_status || mapConnectionState(inst);
      const owner =
        inst.owner ||
        inst.number ||
        inst.profileName ||
        inst.instance?.owner ||
        slot?.phone_e164 ||
        null;
      return {
        instance: name,
        state,
        owner,
        integration: inst.integration || inst.instance?.integration || null,
        slot_id: slot?.slot_id || null,
        slot_label: slot?.label || null,
        device_id: slot?.device_id || null,
        phone_e164: slot?.phone_e164 || null,
        last_message: slot?.last_message || null,
      };
    }),
  );

  return {
    ok: true,
    enabled: true,
    instances: rows.filter(Boolean),
  };
}

module.exports = {
  isEnabled,
  statusInfo,
  fetchInstances,
  createInstance,
  connectInstance,
  connectWithPairing,
  connectionState,
  mapConnectionState,
  extractQrBase64,
  extractPairingCode,
  instanceNameFromRaw,
  listInstancesOverview,
};
