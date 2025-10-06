// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;            // e.g. https://services.ordertime.com/api
const COMPANY = process.env.OT_COMPANY;          // e.g. ConnectUs (exactly as in OT)
const USERNAME = process.env.OT_USERNAME;        // e.g. email@domain
const PASSWORD = process.env.OT_PASSWORD;        // password
const API_KEY  = process.env.OT_API_KEY;         // optional if using API key
const MODE     = (process.env.OT_AUTH_MODE || (API_KEY ? "APIKEY" : "PASSWORD")).toUpperCase();

if (!BASE) throw new Error("OT_BASE_URL not set");

async function otPost(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OT ${res.status} [${path}] ${t}`);
  }
  return res.json();
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  let payload, headers = {};

  if (MODE === "APIKEY") {
    // API key mode: many tenants expect ApiKey in payload OR a header; try payload first.
    if (!API_KEY) throw new Error("OT_API_KEY not set but OT_AUTH_MODE=APIKEY");
    payload = { ApiKey: API_KEY, Type, Filters, PageNumber, NumberOfRecords };
    // If your tenant needs a header instead, uncomment:
    // headers["X-Api-Key"] = API_KEY;
  } else {
    // Username/password mode (recommended)
    if (!COMPANY || !USERNAME || !PASSWORD) {
      throw new Error("OT_COMPANY/OT_USERNAME/OT_PASSWORD must be set for PASSWORD mode");
    }
    payload = {
      Company: COMPANY,
      Username: USERNAME,
      Password: PASSWORD,
      Type, Filters, PageNumber, NumberOfRecords,
    };
  }

  const out = await otPost("/List", payload, headers);
  // Normalize records shape
  const recs = Array.isArray(out?.Records) ? out.Records : (Array.isArray(out?.records) ? out.records : []);
  return recs;
}

module.exports = { otList };
