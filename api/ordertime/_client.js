// api/ordertime/_client.js

const BASE = process.env.OT_BASE_URL || "https://services.ordertime.com/api";

/**
 * Build the auth object for the OrderTime /list payload.
 * APIKEY mode -> { ApiKey: "<key>" }
 * PASSWORD mode -> { Company, Username, Password } (kept for future)
 */
function buildAuth() {
  const mode = (process.env.OT_AUTH_MODE || "APIKEY").toUpperCase();

  if (mode === "APIKEY") {
    const apiKey = process.env.OT_API_KEY;
    if (!apiKey) throw new Error("Missing OT_API_KEY.");
    return { ApiKey: apiKey };
  }

  // fallback: PASSWORD (kept for completeness)
  const { OT_COMPANY, OT_USERNAME, OT_PASSWORD } = process.env;
  if (!OT_COMPANY || !OT_USERNAME || !OT_PASSWORD) {
    throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
  }
  return { Company: OT_COMPANY, Username: OT_USERNAME, Password: OT_PASSWORD };
}

/**
 * POST /list to OrderTime (returns raw JSON)
 * @param {object} body - body WITHOUT auth; we’ll merge auth here
 */
async function postList(body) {
  const url = `${BASE.replace(/\/$/, "")}/list`;
  const payload = { ...buildAuth(), ...body };

  // Safe, minimal logging for debugging
  console.log("[OT] POST /list", {
    url,
    Type: payload.Type,
    hasFilters: Array.isArray(payload.Filters) && payload.Filters.length > 0,
    PageNumber: payload.PageNumber,
    NumberOfRecords: payload.NumberOfRecords,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { Message: text };
  }

  if (!res.ok) {
    const preview = typeof json === "object" ? JSON.stringify(json) : text;
    console.error("[OT] /list response", { status: res.status, preview });
    throw new Error(`OT ${res.status} [/list] ${preview || "Unknown error"}`);
  }

  return json;
}

module.exports = { postList };
