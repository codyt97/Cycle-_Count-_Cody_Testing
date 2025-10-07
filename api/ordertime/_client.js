// api/ordertime/_client.js
const BASE = process.env.OT_BASE_URL;          // e.g. https://services.ordertime.com/api
const COMPANY = (process.env.OT_COMPANY || "").trim();
const USERNAME = (process.env.OT_USERNAME || "").trim();
const PASSWORD = (process.env.OT_PASSWORD || "").trim();

if (!BASE) throw new Error("OT_BASE_URL not set");
if (!COMPANY || !USERNAME || !PASSWORD) {
  throw new Error("OT_COMPANY/OT_USERNAME/OT_PASSWORD must be set for session login");
}

// ---- low-level POST wrapper
async function _post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OT ${res.status} [${path}] ${text}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ---- session handling
let _session = { token: null, // raw token or sessionId returned by /Login
                 acquiredAt: 0,
                 strategy: null }; // how we pass it

// Attempt several token shapes both for /Login and /List usage
// We cache the first working combo.
const LOGIN_PAYLOADS = [
  // Classic
  (c,u,p) => ({ Company: c, Username: u, Password: p }),
  // Some tenants want explicit "Login" casing differences—kept simple here
];

const LIST_WITH_SESSION_STRATEGIES = [
  // 1) put SessionId in body
  (token, payload) => ({ body: { ...payload, SessionId: token }, headers: {}, name: "body:SessionId" }),
  // 2) put SessionToken in body
  (token, payload) => ({ body: { ...payload, SessionToken: token }, headers: {}, name: "body:SessionToken" }),
  // 3) header: X-Session-Id
  (token, payload) => ({ body: payload, headers: { "X-Session-Id": token }, name: "header:X-Session-Id" }),
  // 4) header: Authorization: Bearer <token>
  (token, payload) => ({ body: payload, headers: { "Authorization": `Bearer ${token}` }, name: "header:Authorization Bearer" }),
  // 5) header: Authorization: Session <token>
  (token, payload) => ({ body: payload, headers: { "Authorization": `Session ${token}` }, name: "header:Authorization Session" }),
];

async function _login() {
  let lastErr;
  for (const make of LOGIN_PAYLOADS) {
    try {
      const out = await _post("/Login", make(COMPANY, USERNAME, PASSWORD));
      // heuristic: prefer commonly returned fields
      const token = out?.SessionId || out?.SessionToken || out?.Token || out?.token || out?.sessionId || out?.session || null;
      if (!token) throw new Error(`/Login returned no session: ${JSON.stringify(out)}`);
      _session = { token, acquiredAt: Date.now(), strategy: null };
      console.log("[OT] login OK");
      return token;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All /Login payload shapes failed");
}

function _isSessionFresh() {
  // treat as valid for ~50 minutes unless OT dictates otherwise
  return _session.token && (Date.now() - _session.acquiredAt) < (50 * 60 * 1000);
}

async function _ensureSession() {
  if (_isSessionFresh()) return _session.token;
  return _login();
}

// ---- public: /List with a session
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const payload = { Type, Filters, PageNumber, NumberOfRecords };

  const token = await _ensureSession();

  // fast path if we already discovered a working strategy
  if (_session.strategy) {
    const s = _session.strategy(token, payload);
    const out = await _post("/List", s.body, s.headers);
    const records = Array.isArray(out?.Records) ? out.Records
                   : Array.isArray(out?.records) ? out.records : [];
    return records;
  }

  // try all session strategies once, remember the first winner
  let lastErr;
  for (const fn of LIST_WITH_SESSION_STRATEGIES) {
    const s = fn(token, payload);
    try {
      console.log(`[OT] trying list strategy=${s.name} keys=${Object.keys(s.body)}`);
      const out = await _post("/List", s.body, s.headers);
      const records = Array.isArray(out?.Records) ? out.Records
                     : Array.isArray(out?.records) ? out.records : [];
      _session.strategy = fn; // cache working strategy
      return records;
    } catch (e) {
      lastErr = e;
      // If the session is invalid/expired, force a relogin once and retry this strategy
      const msg = String(e.message || "");
      if (msg.includes("OT 401") || msg.toLowerCase().includes("unauthorized")) {
        await _login();
        try {
          const retried = fn(_session.token, payload);
          const out = await _post("/List", retried.body, retried.headers);
          const records = Array.isArray(out?.Records) ? out.Records
                         : Array.isArray(out?.records) ? out.records : [];
          _session.strategy = fn;
          return records;
        } catch (e2) { lastErr = e2; }
      }
    }
  }
  throw lastErr || new Error("All /List session strategies failed");
}

module.exports = { otList };
