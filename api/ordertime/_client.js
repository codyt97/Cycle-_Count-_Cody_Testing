// No node-fetch import needed on Vercel Node 18+ (fetch is global)
const BASE = process.env.OT_BASE_URL || "https://services.ordertime.com/api";
const MODE = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

/**
 * Build the OrderTime /list payload based on the configured auth mode.
 */
function buildPayload({ Type, Filters, PageNumber = 1, NumberOfRecords = 50 }) {
  const payload = { Type, PageNumber, NumberOfRecords };
  if (Filters && Filters.length) payload.Filters = Filters;

  if (MODE === "APIKEY") {
    const apiKey = process.env.OT_API_KEY;
    if (!apiKey) throw new Error("OT_API_KEY is missing while OT_AUTH_MODE=APIKEY.");
    payload.ApiKey = apiKey;
  } else {
    const company = process.env.OT_COMPANY;
    const username = process.env.OT_USERNAME;
    const password = process.env.OT_PASSWORD;
    if (!company || !username || !password) {
      throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
    }
    payload.Company = company;
    payload.Username = username;
    payload.Password = password;
  }

  return payload;
}

/**
 * POST /list to OrderTime.
 */
async function postList(body) {
  const url = `${BASE}/list`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface OT error text so you can see the real reason in Vercel logs
    throw new Error(`OT ${res.status} [/list] ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

module.exports = { buildPayload, postList };
