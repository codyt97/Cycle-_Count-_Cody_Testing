// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;        // must be https://services.ordertime.com/api
const API_KEY = (process.env.OT_API_KEY || "").trim();

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!API_KEY) throw new Error("OT_API_KEY not set");

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OT ${res.status} [${path}] ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Single, unambiguous auth shape that most tenants use: ApiKey in body.
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const payload = { ApiKey: API_KEY, Type, Filters, PageNumber, NumberOfRecords };
  // TEMP: log payload keys (not values) so we see we're not sending user/pass
  console.log("[OT] /List payload keys:", Object.keys(payload));
  const out = await post("/List", payload);
  const records = Array.isArray(out?.Records) ? out.Records
                : Array.isArray(out?.records) ? out.records : [];
  return records;
}

module.exports = { otList };
