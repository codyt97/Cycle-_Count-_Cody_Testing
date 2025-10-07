// api/ordertime/_client.js
const fetch = require("node-fetch");

const BASE = (process.env.OT_BASE_URL || "https://services.ordertime.com/api").replace(/\/+$/, "");
const MODE = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

function buildAuth() {
  if (MODE === "PASSWORD") {
    const Company  = process.env.OT_COMPANY || "";
    const Username = process.env.OT_USERNAME || "";
    const Password = process.env.OT_PASSWORD || "";
    if (!Company || !Username || !Password) {
      throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
    }
    return { Company, Username, Password };
  }

  if (MODE === "APIKEY") {
    const ApiKey = process.env.OT_API_KEY || "";
    if (!ApiKey) throw new Error("Missing OT_API_KEY.");
    return { ApiKey };
  }

  throw new Error(`Unknown OT_AUTH_MODE: ${MODE}`);
}

async function postList(body) {
  const auth = buildAuth();

  // Build exactly what OT expects – do NOT include fields for the other auth mode.
  const payload = { ...auth, ...body };

  // For debugging without secrets:
  console.log("[OT] POST /list", {
    mode: MODE,
    hasCompany: Boolean(process.env.OT_COMPANY),
    hasUsername: Boolean(process.env.OT_USERNAME),
    hasPassword: Boolean(process.env.OT_PASSWORD),
    hasApiKey: Boolean(process.env.OT_API_KEY),
    base: BASE,
    type: body?.Type
  });

  const res = await fetch(`${BASE}/list`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    // OT sends 400 with { Message: "..."} when payload is off.
    let msg = text;
    try { msg = JSON.parse(text)?.Message || text; } catch {}
    throw new Error(`OT ${res.status} [/list] ${msg}`);
  }

  try {
    const json = JSON.parse(text);
    // Some tenants wrap in { Rows: [...] }, others return the array directly.
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.Rows)) return json.Rows;
    return json || [];
  } catch {
    // If body is an array but parsed as text, try a safe fallback:
    return [];
  }
}

module.exports = { postList, otList: postList };
