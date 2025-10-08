// api/ordertime/_client.js
const BASE = (process.env.OT_BASE_URL || 'https://services.ordertime.com/api').replace(/\/+$/,'');

function mode() {
  const m = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase().trim();
  return m === 'API_KEY' ? 'API_KEY' : 'PASSWORD';
}

function sanitizeKey() {
  return (process.env.OT_API_KEY || '').replace(/^["']|["']$/g,'').trim();
}
function clean(s){ return (s || '').trim(); }
function mask(s){ if(!s) return {len:0, head:'', tail:''}; const t=String(s); return {len:t.length, head:t.slice(0,2), tail:t.slice(-2)}; }

function buildBasePayload({ type, filters = [], page = 1, pageSize = 50 }) {
  return { Type: type, Filters: filters, PageNumber: page, NumberOfRecords: pageSize };
}

async function tryList(url, payload) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const preview = await res.text().catch(()=> '');
    return { ok:false, status:res.status, preview };
  }
  const data = await res.json();
  return { ok:true, data };
}

async function postList(payload) {
  // We’ll try both casings of the endpoint
  const urls = [`${BASE}/list`, `${BASE}/List`];

  // If PASSWORD mode, auto-try Company and Username permutations (common OT gotchas)
  if (mode() === 'PASSWORD') {
    const companyEnv  = clean(payload.Company);
    const usernameEnv = clean(payload.Username);
    const passwordEnv = clean(payload.Password);

    const companyCandidates = Array.from(new Set([
      companyEnv,
      'ConnectUs',
      'Connect Us',
      'ConnectUS',
      'ConnectUs Corp',
      'ConnectUs Corporation',
      'ConnectUs - Live',
      'ConnectUs Live',
    ])).filter(Boolean);

    const bareUser = usernameEnv.includes('@') ? usernameEnv.split('@')[0] : usernameEnv;
    const userCandidates = Array.from(new Set([usernameEnv, bareUser])).filter(Boolean);

    for (const url of urls) {
      for (const c of companyCandidates) {
        for (const u of userCandidates) {
          const attempt = { ...payload, Company: c, Username: u, Password: passwordEnv };
          console.log('[OT] POST /list attempt', { url, mode:'PASSWORD', company:mask(c), username:mask(u), hasPassword:!!passwordEnv, Type: payload.Type, PageNumber: payload.PageNumber, NumberOfRecords: payload.NumberOfRecords });
          const r = await tryList(url, attempt);
          if (r.ok) return r.data;
          // Only log the first ~160 chars of error to avoid noise
          console.error('[OT] /list response', { status:r.status, preview:(r.preview || '').slice(0,160) });
        }
      }
    }
    throw new Error('All PASSWORD /list attempts failed');
  }

  // API_KEY mode (optionally include Company)
  const apiKey = sanitizeKey();
  const company = clean(payload.Company);
  const akPayload = { ApiKey: apiKey, Type: payload.Type, Filters: payload.Filters, PageNumber: payload.PageNumber, NumberOfRecords: payload.NumberOfRecords };
  const keyVariants = [ { ...akPayload }, { ...(company ? { Company: company } : {}), ...akPayload } ];

  for (const url of urls) {
    for (const p of keyVariants) {
      console.log('[OT] POST /list attempt', { url, mode:'API_KEY', apiKeyLen:(p.ApiKey||'').length, company: mask(p.Company), Type: p.Type, PageNumber: p.PageNumber, NumberOfRecords: p.NumberOfRecords });
      const r = await tryList(url, p);
      if (r.ok) return r.data;
      console.error('[OT] /list response', { status:r.status, preview:(r.preview || '').slice(0,160) });
    }
  }

  throw new Error('All API_KEY /list attempts failed');
}

// Public helpers -------------------------------------------------------------
function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  const base = buildBasePayload({ type, filters, page, pageSize });
  if (mode() === 'API_KEY') {
    const company = clean(process.env.OT_COMPANY);
    return { ...(company ? { Company: company } : {}), ApiKey: sanitizeKey(), ...base };
  }
  const company = clean(process.env.OT_COMPANY);
  const username = clean(process.env.OT_USERNAME);
  const password = clean(process.env.OT_PASSWORD);
  if (!company || !username || !password) throw new Error('Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.');
  return { Company: company, Username: username, Password: password, ...base };
}

async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  const payload = buildPayload({ type: Type, filters: Filters, page: PageNumber, pageSize: NumberOfRecords });
  const data = await postList(payload);
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

module.exports = { buildPayload, postList, otList };
