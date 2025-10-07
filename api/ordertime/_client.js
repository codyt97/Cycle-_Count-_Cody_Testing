// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL || "https://services.ordertime.com/api";
const MODE = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

const COMPANY  = process.env.OT_COMPANY || "";
const USERNAME = process.env.OT_USERNAME || "";
const PASSWORD = process.env.OT_PASSWORD || "";

/**
 * Build the /api/list payload (PASSWORD mode only).
 * DO NOT include ApiKey when using PASSWORD auth — OT will return "Incorrect api key".
 */
function buildPayload({ type, filters = [], page = 1, size = 50, select = undefined }) {
  if (MODE !== "PASSWORD") {
    throw new Error("Only PASSWORD mode is supported in this build. Set OT_AUTH_MODE=PASSWORD.");
  }

  if (!COMPANY || !USERNAME || !PASSWORD) {
    throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
  }

  const body = {
    Company: COMPANY,
    Username: USERNAME,
    Password: PASSWORD,
    Type: type,
    Filters: filters,
    PageNumber: page,
    NumberOfRecords: size
  };

  if (select && Array.isArray(select) && select.length) {
    body.Select = select; // optional "Select" projection if you want to trim payloads
  }

  return body;
}

async function postList({ type, filters, page = 1, size = 50, select }) {
  const url = `${BASE}/list`;
  const payload = buildPayload({ type, filters, page, size, select });

  console.info("[OT] POST", url, {
    mode: "PASSWORD",
    base: BASE,
    type,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "object" && data?.Message
      ? data.Message
      : text || res.statusText;
    throw new Error(`OT ${res.status} [/list] ${msg}`);
  }

  // OT returns plain arrays for success
  return Array.isArray(data) ? data : [];
}

module.exports = { postList };
