// api/ordertime/_client.js

// ---- base URLs (tries tenant base, then services base) ----
const PRIMARY_BASE = (process.env.OT_BASE_URL || 'https://services.ordertime.com/api').replace(/\/+$/,'');
const TENANT_BASE  = (process.env.OT_TENANT_BASE_URL || '').replace(/\/+$/,'');
const BASES = [TENANT_BASE, PRIMARY_BASE].filter(Boolean);

function clean(s){ return (s || '').trim(); }
function stripQuotes(s){ return (s || '').replace(/^["']|["']$/g,'').trim(); }
function mask(s){ if(!s) return {len:0, head:'', tail:''}; const t=String(s); return {len:t.length, head:t.slice(0,2), tail:t.slice(-2)}; }

const CONF = {
  company: clean(process.env.OT_COMPANY),
  username: clean(process.env.OT_USERNAME),
  password: clean(process.env.OT_PASSWORD),
  envApiKey: stripQuotes(process.env.OT_API_KEY),
  authMode: (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase().trim() // API_KEY or PASSWORD
};

// ---- small cache for a session key from /Login ----
let cachedKey = null;
let cachedAt  = 0;
const KEY_TTL_MS = 1000 * 60 * 20; // 20 minutes

function haveFreshKey(){
  return cachedKey && (Date.now() - cachedAt) < KEY_TTL_MS;
}

async function doPostMulti(path, payload) {
  let lastErr;
  for (const base of BASES) {
    const url = `${base}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw:text }; }
      if (!res.ok) {
        const msg = data?.Message || data?.error || text || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.url = url;
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      console.error('[OT] POST fail', { url, status: e.status, preview: e.message });
    }
  }
  throw lastErr || new Error('All base URL attempts failed');
}

// ---- /Login to obtain a session ApiKey (works across tenants) ----
async function otLogin() {
  const company  = CONF.company;
  const username = CONF.username;
  const password = CONF.password;

  if (!company || !username || !password) {
    throw new Error('Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD for PASSWORD mode.');
  }

  const payload = { Company: company, Username: username, Password: password };
  console.info('[OT] POST /Login attempt', { bases: BASES, company: mask(company) });

  // Try both casings (/login, /Login)
  const data = await (async () => {
    try { return await doPostMulti('/login', payload); } catch (e1) {
      return await doPostMulti('/Login', payload);
    }
  })();

  const apiKey = data?.ApiKey || data?.Api_Key || data?.Key || data?.ApiToken || null;
  if (!apiKey) throw new Error('Login succeeded but no ApiKey returned.');
  cachedKey = apiKey;
  cachedAt  = Date.now();
  console.info('[OT] /Login success, keyLen=', mask(apiKey).len);
  return apiKey;
}

async function getApiKeyForList() {
  // 1) Use env key in API_KEY mode if present
  if (CONF.authMode === 'API_KEY' && CONF.envApiKey) return CONF.envApiKey;

  // 2) If we already logged in recently, reuse
  if (haveFreshKey()) return cachedKey;

  // 3) Login to fetch a fresh key
  return await otLogin();
}

// ---- public helpers ----
function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  return { Type: type, Filters: filters, PageNumber: page, NumberOfRecords: pageSize };
}

// This always calls /list with an ApiKey, regardless of how we obtained it (env or /Login)
async function postList(base) {
  const pathCandidates = ['/list', '/List'];

  // figure out an api key
  let apiKey = null;
  try {
    apiKey = await getApiKeyForList();
  } catch (e) {
    // if API_KEY mode but env key is invalid, we still try login with PASSWORD if creds exist
    if (CONF.username && CONF.password && CONF.company) {
      console.warn('[OT] Falling back to /Login because env key not usable:', e.message);
      apiKey = await otLogin();
    } else {
      throw e;
    }
  }

  const attempts = pathCandidates.map(p => ({ path: p, payload: { ...base, ApiKey: apiKey } }));

  let lastErr;
  for (const a of attempts) {
    try {
      const dbg = {
        bases: BASES,
        path: a.path,
        mode: CONF.authMode,
        apiKeyLen: mask(apiKey).len,
        Type: base.Type, PageNumber: base.PageNumber, NumberOfRecords: base.NumberOfRecords
      };
      console.info('[OT] POST', a.path, 'attempt', JSON.stringify(dbg, null, 2));
      const data = await doPostMulti(a.path, a.payload);
      return data;
    } catch (e) {
      lastErr = e;
      // If we got a 400 about the key, nuke cache and try one more time by re-login
      const msg = (e.message || '').toLowerCase();
      const keyBad = e.status === 400 && (msg.includes('incorrect api key') || msg.includes('deactivated'));
      if (keyBad && CONF.username && CONF.password && CONF.company) {
        console.warn('[OT] Key rejected; refreshing via /Login once...');
        cachedKey = null; cachedAt = 0;
        const fresh = await otLogin();
        // retry this exact path once with the new key
        const data = await doPostMulti(a.path, { ...base, ApiKey: fresh });
        return data;
      }
    }
  }
  throw lastErr || new Error('All /list attempts failed');
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  const payload = buildPayload({ type: Type, filters: Filters, page: PageNumber, pageSize: NumberOfRecords });
  const data = await postList(payload);
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

module.exports = { buildPayload, postList, otList };
