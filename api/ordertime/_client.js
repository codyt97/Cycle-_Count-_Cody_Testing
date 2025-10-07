// api/ordertime/_client.js

// One (and only one) BASE definition:
const BASE = process.env.OT_BASE_URL || "https://services.ordertime.com/api";

// Decide auth mode: APIKEY by default if present, or PASSWORD if requested
function resolveAuthMode() {
  const wantsPassword = String(process.env.OT_AUTH_MODE || "").toUpperCase() === "PASSWORD";
  const hasKey   = !!process.env.OT_API_KEY;
  const hasLogin = !!process.env.OT_EMAIL && !!process.env.OT_PASSWORD;

  if (wantsPassword) {
    if (!hasLogin) throw new Error("OrderTime login missing: set OT_EMAIL and OT_PASSWORD (and OT_COMPANY if required).");
    return "PASSWORD";
  }
  if (hasKey)   return "APIKEY";
  if (hasLogin) return "PASSWORD";

  throw new Error("OrderTime credentials missing: set OT_API_KEY or OT_EMAIL/OT_PASSWORD.");
}

function buildAuth(mode) {
  if (mode === "APIKEY") {
    return { ApiKey: process.env.OT_API_KEY };
  }
  // PASSWORD
  const auth = {
    Username: process.env.OT_EMAIL,
    Password: process.env.OT_PASSWORD,
  };
  if (process.env.OT_COMPANY) auth.Company = process.env.OT_COMPANY;
  return auth;
}

async function postList(body) {
  const url = `${BASE}/list`;
  const mode = resolveAuthMode();
  const auth = buildAuth(mode);
  const payload = { ...auth, ...body };

  console.log("[OT] POST", url, {
    mode,
    hasApiKey: !!process.env.OT_API_KEY,
    hasEmail:  !!process.env.OT_EMAIL,
    base: BASE,
    type: body?.Type,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data;
  try { data = text ? JSON.parse(text) : []; } catch { data = []; }

  if (!resp.ok) {
    const msg = data?.Message || text || `HTTP ${resp.status}`;
    throw new Error(`OT ${resp.status} [/list] ${msg}`);
  }
  if (!Array.isArray(data)) {
    if (data && data.Message) throw new Error(data.Message);
    return [];
  }
  return data;
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  return postList({ Type, Filters, PageNumber, NumberOfRecords });
}

module.exports = { otList };
