/**
 * Envia eventos para webhooks do n8n.
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
const EVENT_URLS = {
  job_created: process.env.N8N_WEBHOOK_JOB_CREATED,
  file_uploaded: process.env.N8N_WEBHOOK_FILE_UPLOADED,
  job_progress: process.env.N8N_WEBHOOK_JOB_PROGRESS,
};

const DEFAULT_URL = process.env.N8N_WEBHOOK_URL || "";

function resolveUrl(event) {
  return EVENT_URLS[event] || DEFAULT_URL;
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} payload
 */
async function notifyN8n(event, payload) {
  const url = resolveUrl(event);
  if (!url) {
    return { ok: false, error: "not_configured" };
  }

  const body = {
    event,
    at: new Date().toISOString(),
    ...payload,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[n8n] ${event} → HTTP ${res.status} ${url}`);
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    console.log(`[n8n] ${event} → OK`);
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn(`[n8n] ${event} falhou:`, err.message);
    return { ok: false, error: err.message };
  }
}

function isConfigured() {
  return Boolean(DEFAULT_URL || Object.values(EVENT_URLS).some(Boolean));
}

module.exports = { notifyN8n, isConfigured };
