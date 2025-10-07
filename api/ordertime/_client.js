// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;       // https://services.ordertime.com/api
const COMPANY = process.env.OT_COMPANY;     // ConnectUs (exact in OT)
const USERNAME = process.env.OT_USERNAME;   // email in OT
const PASSWORD = process.env.OT_PASSWORD;   // password in OT

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!COMPANY || !USERNAME || !PASSWORD) {
  throw new Error("OT_COMPANY/OT_USERNAME/OT_PASSWORD must be set");
}

async function otPost(path, body) {
  // TEMP: payload keys to confirm no ApiKey sneaks in
  try { console.log("OT payload keys:", Object.keys(body || {})); } catch {}
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OT ${res.status} [${path}] ${t}`);
  }
  return res.json();
}

// /api/List wrapper in PASSWORD mode only (no ApiKey)
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const payload = {
    Company: COMPANY,
    Username: USERNAME,
    Password: PASSWORD,
    Type,
    Filters,
    PageNumber,
    NumberOfRecords,
  };
  const out = await otPost("/List", payload);
  const records = Array.isArray(out?.Records)
    ? out.Records
    : (Array.isArray(out?.records) ? out.records : []);
  return records;
}

module.exports = { otList };
