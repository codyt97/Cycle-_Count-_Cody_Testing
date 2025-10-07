// api/ordertime/_client.js
// OrderTime client using header-based auth and numeric RecordTypeEnum for /list

const BASE   = process.env.OT_BASE_URL;   // e.g. https://services.ordertime.com/api
const APIKEY = (process.env.OT_API_KEY || "").trim();
const EMAIL  = (process.env.OT_EMAIL    || "").trim();
// Use ONE of the following: OT_PASSWORD or OT_DEVKEY
const PASS   = (process.env.OT_PASSWORD || "").trim();
const DEVKEY = (process.env.OT_DEVKEY   || "").trim();

if (!BASE)   throw new Error("OT_BASE_URL not set");
if (!APIKEY) throw new Error("OT_API_KEY not set");
if (!EMAIL)  throw new Error("OT_EMAIL not set");
if (!PASS && !DEVKEY) {
  throw new Error("Set either OT_PASSWORD or OT_DEVKEY for OrderTime auth");
}

function authHeaders() {
  const h = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "apiKey": APIKEY,
    "email": EMAIL,
  };
  if (DEVKEY) h["DevKey"] = DEVKEY; else h["password"] = PASS;
  return h;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OT ${res.status} [${path}] ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Generic /list wrapper.
 * NOTE: Type MUST be the numeric RecordTypeEnum value (e.g., 151 for Bin, 1100 for Lot/Serial)
 */
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const payload = { Type, Filters, PageNumber, NumberOfRecords };
  const out = await post("/list", payload);
  // Normalize response
  const records = Array.isArray(out?.Records)
    ? out.Records
    : (Array.isArray(out?.records) ? out.records : []);
  return records;
}

module.exports = { otList };
