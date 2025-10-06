// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;
const COMPANY = process.env.OT_COMPANY;
const USERNAME = process.env.OT_USERNAME;
const PASSWORD = process.env.OT_PASSWORD;

if (!BASE) throw new Error("OT_BASE_URL not set");

async function otPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OT ${res.status} [${path}] ${t}`);
  }
  return res.json();
}

// Helper for /api/List with Filters
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const payload = {
    Company: COMPANY,
    Username: USERNAME,
    Password: PASSWORD,
    Type,
    Filters,
    PageNumber,
    NumberOfRecords
  };
  const out = await otPost("/List", payload);
  // Expect out.Records or similar; normalize.
  const records = Array.isArray(out?.Records) ? out.Records : (Array.isArray(out?.records) ? out.records : []);
  return records;
}

module.exports = { otList };
