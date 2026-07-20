/**
 * HeroSMS (compatível SMS-Activate) — getNumber / getStatus / setStatus.
 * @see https://hero-sms.com/stubs/handler_api.php
 */
const HERO_SMS_BASE =
  (process.env.HERO_SMS_BASE_URL || "https://hero-sms.com/stubs/handler_api.php").replace(/\/$/, "");
const HERO_SMS_API_KEY = process.env.HERO_SMS_API_KEY || "";
const HERO_SMS_SERVICE = process.env.HERO_SMS_SERVICE || "wa";
const HERO_SMS_COUNTRY = process.env.HERO_SMS_COUNTRY || "73";

function isConfigured() {
  return Boolean(HERO_SMS_API_KEY);
}

function statusInfo() {
  return {
    configured: isConfigured(),
    base_url: HERO_SMS_BASE,
    service: HERO_SMS_SERVICE,
    country: HERO_SMS_COUNTRY,
  };
}

async function heroGet(params) {
  if (!isConfigured()) {
    return { ok: false, error: "hero_sms_not_configured" };
  }
  const qs = new URLSearchParams({
    api_key: HERO_SMS_API_KEY,
    ...params,
  });
  const url = `${HERO_SMS_BASE}?${qs.toString()}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const text = (await res.text()).trim();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/** ACCESS_NUMBER:activationId:phoneDigits */
async function getNumber({ service = HERO_SMS_SERVICE, country = HERO_SMS_COUNTRY } = {}) {
  const result = await heroGet({
    action: "getNumber",
    service: String(service),
    country: String(country),
  });
  if (!result.ok && result.error) return result;
  const text = result.text || "";
  if (text.startsWith("ACCESS_NUMBER:")) {
    const parts = text.split(":");
    const activationId = parts[1] || "";
    let phone = (parts.slice(2).join(":") || "").replace(/\D/g, "");
    if (phone && !phone.startsWith("+")) {
      /* keep digits only for E.164 builder */
    }
    const phone_e164 = phone ? `+${phone}` : null;
    return {
      ok: true,
      activation_id: activationId,
      phone_digits: phone,
      phone_e164,
      raw: text,
    };
  }
  return { ok: false, error: text || result.error || "getNumber_failed", raw: text };
}

/** STATUS_OK:code | STATUS_WAIT_CODE | … */
async function getStatus(activationId) {
  const result = await heroGet({
    action: "getStatus",
    id: String(activationId),
  });
  if (!result.ok && result.error) return result;
  const text = result.text || "";
  if (text.startsWith("STATUS_OK:")) {
    const code = text.slice("STATUS_OK:".length).trim();
    return { ok: true, ready: true, code, raw: text };
  }
  if (text === "STATUS_WAIT_CODE" || text.startsWith("STATUS_WAIT")) {
    return { ok: true, ready: false, waiting: true, raw: text };
  }
  return { ok: false, error: text || "getStatus_failed", raw: text };
}

/** status=6 complete, 8 cancel */
async function setStatus(activationId, status) {
  const result = await heroGet({
    action: "setStatus",
    id: String(activationId),
    status: String(status),
  });
  if (!result.ok && result.error) return result;
  return { ok: true, raw: result.text };
}

async function getBalance() {
  const result = await heroGet({ action: "getBalance" });
  if (!result.ok && result.error) return result;
  const text = result.text || "";
  if (text.startsWith("ACCESS_BALANCE:")) {
    return { ok: true, balance: Number(text.split(":")[1]) || 0, raw: text };
  }
  return { ok: false, error: text || "getBalance_failed", raw: text };
}

module.exports = {
  isConfigured,
  statusInfo,
  getNumber,
  getStatus,
  setStatus,
  getBalance,
};
