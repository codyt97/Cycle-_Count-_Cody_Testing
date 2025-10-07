// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;       // https://services.ordertime.com/api
const API_KEY = process.env.OT_API_KEY;     // new active key

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!API_KEY) throw new Error("OT_API_KEY not set");

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
  // pure API-key payload
  const payload = { ApiKey: API_KEY, Type, Filters, PageNumber, NumberOfRecords };
  const out = await otPost("/List", payload);
  const records = Array.isArray(out?.Records)
    ? out.Records
    : (Array.isArray(out?.records) ? out.records : []);
  return records;
}

module.exports = { otList };
