// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;        // https://services.ordertime.com/api
const API_KEY = (process.env.OT_API_KEY || "").trim();

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!API_KEY) throw new Error("OT_API_KEY not set");

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OT ${res.status} [${path}] ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  // canonical shape: ApiKey in body, POST /api/list (lowercase)
  const payload = { ApiKey: API_KEY, Type, Filters, PageNumber, NumberOfRecords };
  const out = await post("/list", payload);
  const records = Array.isArray(out?.Records) ? out.Records
                : Array.isArray(out?.records) ? out.records : [];
  return records;
}

module.exports = { otList };
