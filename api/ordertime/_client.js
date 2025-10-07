// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;          // e.g. https://services.ordertime.com/api
const API_KEY = (process.env.OT_API_KEY || "").trim();
const COMPANY = (process.env.OT_COMPANY || "").trim(); // some tenants require Company even in key mode

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!API_KEY) throw new Error("OT_API_KEY not set");

// small helper to throw rich errors
async function _post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OT ${res.status} [${path}] ${text}`);
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Try multiple authentication “shapes” in order until one succeeds.
// We cache the first working strategy in memory to avoid extra round trips.
let _workingStrategy = null;

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const strategies = _workingStrategy
    ? [_workingStrategy] // fast-path
    : [
        // 1) ApiKey in body (most common)
        { name: "body:ApiKey", body: { ApiKey: API_KEY }, headers: {} },
        // 2) ApiKey + Company in body (some tenants want both)
        { name: "body:ApiKey+Company", body: { ApiKey: API_KEY, Company: COMPANY }, headers: {} },
        // 3) X-Api-Key header
        { name: "header:X-Api-Key", body: {}, headers: { "X-Api-Key": API_KEY } },
        // 4) Authorization: ApiKey <key>
        { name: "header:Authorization ApiKey", body: {}, headers: { "Authorization": `ApiKey ${API_KEY}` } },
        // 5) Authorization: Bearer <key>
        { name: "header:Authorization Bearer", body: {}, headers: { "Authorization": `Bearer ${API_KEY}` } },
      ];

  let lastErr = null;

  for (const s of strategies) {
    try {
      const basePayload = { Type, Filters, PageNumber, NumberOfRecords };
      // include Company in body if we already have a body AND tenant needs it
      const payload =
        s.name.includes("body:")
          ? { ...s.body, ...basePayload }
          : { ...basePayload };

      // TRACE (safe): show strategy and payload keys, **not** secrets
      console.log(`[OT] trying strategy=${s.name} keys=${Object.keys(payload)}`);

      const out = await _post("/List", payload, s.headers);
      // Normalize records
      const records = Array.isArray(out?.Records)
        ? out.Records
        : (Array.isArray(out?.records) ? out.records : []);

      _workingStrategy = s; // cache working strategy
      return records;
    } catch (e) {
      lastErr = e;
      // Continue to next strategy on 400/401
      const msg = String(e.message || "");
      if (!(msg.includes("OT 400") || msg.includes("OT 401"))) break; // other errors: stop early
    }
  }

  // If all strategies failed, throw the last error
  throw lastErr || new Error("All OT auth strategies failed");
}

module.exports = { otList };
