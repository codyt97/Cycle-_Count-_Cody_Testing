// api/ordertime/_client.js
const PRIMARY_BASE = (process.env.OT_BASE_URL || 'https://services.ordertime.com/api').replace(/\/+$/,'');
// Optional tenant hint (e.g., connectus.ordertime.com/api)
const TENANT_BASE  = (process.env.OT_TENANT_BASE_URL || '').replace(/\/+$/,'');
const BASES = [PRIMARY_BASE, TENANT_BASE].filter(Boolean);


function clean(s){ return (s || '').trim(); }
function stripQuotes(s){ return (s || '').replace(/^["']|["']$/g,'').trim(); }
function mask(s){ if(!s) return {len:0, head:'', tail:''}; const t=String(s); return {len:t.length, head:t.slice(0,2), tail:t.slice(-2)}; }

function buildBase({ type, filters = [], page = 1, pageSize = 50 }) {
  return { Type: type, Filters: filters, PageNumber: page, NumberOfRecords: pageSize };
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

async function doPost(path, payload) {
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
    err.payload = payload;
    throw err;
  }
  return data;
}

// Build attempt payloads for both modes
function buildAttempts(base) {
  const attempts = [];

  // API KEY attempts
  const apiKey = stripQuotes(process.env.OT_API_KEY);
  const companyEnv = clean(process.env.OT_COMPANY);
  if (apiKey) {
    for (const c of [companyEnv, 'ConnectUs', 'ConnectUS', '']) {
      attempts.push({
        label: `API_KEY :: Company="${c}"`,
        payload: (c ? { Company: c } : {}),
        mode: 'API_KEY',
      });
    }
  }

  // PASSWORD attempts
  const usernameEnv = clean(process.env.OT_USERNAME);
  const passwordEnv = clean(process.env.OT_PASSWORD);
  if (usernameEnv && passwordEnv) {
    const usernames = [usernameEnv];
    // also try without domain if present
    if (usernameEnv.includes('@')) usernames.push(usernameEnv.split('@')[0]);
    const companies = [companyEnv, 'ConnectUs', 'ConnectUS'].filter(Boolean);

    for (const c of companies) {
      for (const u of usernames) {
        attempts.push({
          label: `PASSWORD :: Company="${c}" Username="${u}"`,
          payload: { Company: c, Username: u, Password: passwordEnv },
          mode: 'PASSWORD',
        });
      }
    }
  }

  // Attach base to each attempt
  return attempts.map(a => ({ ...a, payload: { ...a.payload, ...base } }));
}

async function postList(base) {
    const pathCandidates = ['/list', '/List']; // some tenants are picky
    const attempts = buildAttempts(base);



  if (!attempts.length) {
    throw new Error('No credentials configured. Set either OT_API_KEY or OT_USERNAME/OT_PASSWORD/OT_COMPANY.');
  }

  let lastErr;
  // Try all auth attempts across both path casings
  for (const a of attempts) {
    for (const p of pathCandidates) {
      const body = { ...a.payload };
      if (a.mode === 'API_KEY') {
        body.ApiKey = stripQuotes(process.env.OT_API_KEY);
      }
      try {
        const dbg = {
          bases: BASES,
          path: p,
          mode: a.mode,

          apiKeyLen: a.mode === 'API_KEY' ? mask(stripQuotes(process.env.OT_API_KEY)).len : 0,
          company: mask(body.Company),
          Type: body.Type, PageNumber: body.PageNumber, NumberOfRecords: body.NumberOfRecords
        };
        console.info('[OT] POST', p, 'attempt', JSON.stringify(dbg, null, 2));
        const data = await doPostMulti(p, body);
        return data;
      } catch (e) {
        console.error('[OT] /list response { status:', e.status, ', preview:', JSON.stringify(e.message), '}');
        lastErr = e;
        // If API_KEY got a 400 "Incorrect api key...", immediately fall through to PASSWORD attempts
        if (a.mode === 'API_KEY' && e.status === 400) continue;
      }
    }
  }
  throw new Error(lastErr?.message || 'All /list attempts failed');
}

function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  return buildBase({ type, filters, page, pageSize });
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  const payload = buildPayload({ type: Type, filters: Filters, page: PageNumber, pageSize: NumberOfRecords });
  const data = await postList(payload);
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

module.exports = { buildPayload, postList, otList };
