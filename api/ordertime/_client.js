// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL || "https://services.ordertime.com/api";

function assertCreds() {
  const hasKey   = !!process.env.OT_API_KEY;
  const hasLogin = !!process.env.OT_EMAIL && !!process.env.OT_PASSWORD;
  if (!hasKey && !hasLogin) {
    throw new Error("OrderTime credentials missing: set OT_API_KEY or OT_EMAIL/OT_PASSWORD.");
  }
}

async function postList(body) {
  const url = `${BASE}/list`; // OT is fine with lowercase /list

  // Auth payload (API key preferred)
  assertCreds();
  const auth = {};
  if (process.env.OT_API_KEY) {
    auth.ApiKey = process.env.OT_API_KEY;
  } else {
    if (process.env.OT_COMPANY) auth.Company = process.env.OT_COMPANY;
    auth.Username = process.env.OT_EMAIL;
    auth.Password = process.env.OT_PASSWORD;
  }

  const payload = { ...auth, ...body };

  console.log("[OT] POST", url, {
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
    // OT sometimes returns {Message: "..."} on logical errors
    if (data && data.Message) throw new Error(data.Message);
    return [];
  }
  return data;
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  return postList({ Type, Filters, PageNumber, NumberOfRecords });
}

module.exports = { otList };
