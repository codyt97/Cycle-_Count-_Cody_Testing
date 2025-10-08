// api/ordertime/_client.js
// Hardened OrderTime client: handles inline password, multiple login endpoints, and multi-base fallback.

const DEFAULT_BASES = [
  process.env.OT_TENANT_BASE_URL || "",
  process.env.OT_BASE_URL || "",
  "https://app.ordertime.com/api",
  "https://services.ordertime.com/api",
]
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => s.replace(/\/+$/,""));

function clean(s){ return (s || "").trim(); }
function stripQuotes(s){ return (s || "").replace(/^["']|["']$/g,"").trim(); }
function mask(s){ if(!s) return {len:0, head:"", tail:""}; const t=String(s); return {len:t.length, head:t.slice(0,2), tail:t.slice(-2)}; }

const CONF = {
  company:  clean(process.env.OT_COMPANY),
  username: clean(process.env.OT_USERNAME),
  password: clean(process.env.OT_PASSWORD),
  envApiKey: stripQuotes(process.env.OT_API_KEY),
  authMode: (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase().trim(), // API_KEY | PASSWORD
};

// simple in-memory key cache
let cachedKey = null;
let cachedAt = 0;
const KEY_TTL_MS = 1000 * 60 * 20;
function freshKey(){ return cachedKey && (Date.now() - cachedAt) < KEY_TTL_MS; }

async function httpPostJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.Message || data?.error || text || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.url = url;
    err.body = payload;
    throw err;
  }
  return data;
}

async function postMulti(bases, path, payload) {
  let lastErr;
  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      return await httpPostJson(url, payload);
    } catch (e) {
      lastErr = e;
      console.error("[OT] POST fail", { url, status: e.status, preview: e.message });
    }
  }
  throw lastErr || new Error("All base URL attempts failed");
}

function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  return { Type: type, Filters: filters, PageNumber: page, NumberOfRecords: pageSize };
}

// --- LOGIN HELPERS (many tenants don't have /Login; try a set of candidates) ---
const LOGIN_PATHS = ["/Authenticate", "/Auth/Login", "/auth/login", "/Login"];

function extractKey(loginResp) {
  return loginResp?.ApiKey || loginResp?.Api_Key || loginResp?.Key || loginResp?.ApiToken || null;
}

async function tryLogin(bases) {
  if (!CONF.company || !CONF.username || !CONF.password) {
    throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD for PASSWORD mode.");
  }
  const payload = { Company: CONF.company, Username: CONF.username, Password: CONF.password };
  console.info("[OT] Login attempt", { bases, company: mask(CONF.company) });

  let lastErr;
  for (const p of LOGIN_PATHS) {
    try {
      const data = await postMulti(bases, p, payload);
      const k = extractKey(data);
      if (!k) throw new Error(`Login ${p} succeeded but no ApiKey in response`);
      console.info("[OT] Login success via", p, "keyLen=", mask(k).len);
      return k;
    } catch (e) {
      lastErr = e;
      // keep looping across login endpoints
    }
  }
  throw lastErr || new Error("All login endpoint attempts failed");
}

async function getKey(bases) {
  // If API_KEY mode and env key present, use it
  if (CONF.authMode === "API_KEY" && CONF.envApiKey) return CONF.envApiKey;
  // If we already have a fresh cached key, reuse
  if (freshKey()) return cachedKey;
  // Otherwise try to login across known endpoints
  const k = await tryLogin(bases);
  cachedKey = k; cachedAt = Date.now();
  return k;
}

// --- PUBLIC: call /list with whichever auth the tenant supports ---
async function postList(basePayload) {
  const bases = DEFAULT_BASES.length ? DEFAULT_BASES : ["https://services.ordertime.com/api"];
  const pathCandidates = ["/list", "/List"];

  // Strategy A: INLINE PASSWORD (no ApiKey)
  if (CONF.authMode === "PASSWORD" && CONF.company && CONF.username && CONF.password) {
    for (const path of pathCandidates) {
      try {
        const body = { ...basePayload, Company: CONF.company, Username: CONF.username, Password: CONF.password };
        console.info("[OT] POST", path, "inline-password", JSON.stringify({
          bases, path,
          company: mask(CONF.company),
          user: mask(CONF.username),
          Type: basePayload.Type, PageNumber: basePayload.PageNumber, NumberOfRecords: basePayload.NumberOfRecords
        }, null, 2));
        const data = await postMulti(bases, path, body);
        return data;
      } catch (e) {
        // Some tenants reply with 400 message about api key even when inline creds are correct. We'll fall through.
        const msg = (e.message || "").toLowerCase();
        const treatAsInlineUnsupported = e.status === 404 || msg.includes("resource was not found") || msg.includes("incorrect api key");
        if (!treatAsInlineUnsupported) throw e;
      }
    }
  }

  // Strategy B: OBTAIN/USE API KEY (env or via login), then call /list with ApiKey
  let key = CONF.envApiKey || null;
  if (!key) {
    try {
      key = await getKey(bases);
    } catch (e) {
      // If login not available but we have env key, continue; else bubble up
      if (!CONF.envApiKey) throw e;
    }
  }

  let lastErr;
  for (const path of pathCandidates) {
    try {
      const body = { ...basePayload, ApiKey: key };
      console.info("[OT] POST", path, "with-key", JSON.stringify({
        bases, path, apiKeyLen: mask(key).len,
        Type: basePayload.Type, PageNumber: basePayload.PageNumber, NumberOfRecords: basePayload.NumberOfRecords
      }, null, 2));
      return await postMulti(bases, path, body);
    } catch (e) {
      lastErr = e;
      const msg = (e.message || "").toLowerCase();
      const keyBad = e.status === 400 && (msg.includes("incorrect api key") || msg.includes("deactivated"));
      if (keyBad) { cachedKey = null; cachedAt = 0; }
    }
  }

  // One last shot: if key failed and we can login, do it now and retry once
  if (CONF.company && CONF.username && CONF.password) {
    const fresh = await tryLogin(bases);
    for (const path of pathCandidates) {
      const body = { ...basePayload, ApiKey: fresh };
      try { return await postMulti(bases, path, body); } catch (e) { lastErr = e; }
    }
  }

  throw lastErr || new Error("All /list attempts failed");
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  const basePayload = buildPayload({ type: Type, filters: Filters, page: PageNumber, pageSize: NumberOfRecords });
  const data = await postList(basePayload);
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

module.exports = { buildPayload, postList, otList };
