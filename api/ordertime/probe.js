// api/ordertime/probe.js
const { postList } = require('./_client');

function clean(s) { return (s || '').trim(); }
function mask(s) { return s ? `${s.slice(0,2)}…${s.slice(-2)} (${s.length})` : ''; }

async function tryOnce(name, payload, urlBase) {
  const url = `${(process.env.OT_BASE_URL || 'https://services.ordertime.com/api').replace(/\/+$/,'')}/list`;
  const body = JSON.stringify(payload);
  const res = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body });
  if (res.ok) return { ok:true, status:res.status };
  const preview = await res.text().catch(()=> '');
  return { ok:false, status:res.status, preview: preview.slice(0,180) };
}

module.exports = async (req, res) => {
  const base = (process.env.OT_BASE_URL || '').trim();
  const companyEnv  = clean(process.env.OT_COMPANY);
  const usernameEnv = clean(process.env.OT_USERNAME);
  const passwordEnv = clean(process.env.OT_PASSWORD);
  const apiKeyEnv   = clean(process.env.OT_API_KEY);

  // plausible company variants you might actually have in OT
  const companies = Array.from(new Set([
    companyEnv,
    'ConnectUs',
    'Connect Us',
    'ConnectUS',
    'ConnectUs Corp',
    'ConnectUs Corporation',
  ])).filter(Boolean);

  // username variants (some tenants require login name w/o domain)
  const uBare = usernameEnv.includes('@') ? usernameEnv.split('@')[0] : usernameEnv;
  const usernames = Array.from(new Set([
    usernameEnv,
    uBare,
  ])).filter(Boolean);

  const attempts = [];

  // PASSWORD mode attempts
  for (const c of companies) {
    for (const u of usernames) {
      attempts.push({
        label: `PASSWORD :: Company="${c}" Username="${u}"`,
        payload: {
          Company: c, Username: u, Password: passwordEnv,
          Type: 1141, Filters: [], PageNumber: 1, NumberOfRecords: 1
        }
      });
    }
  }

  // API KEY attempts (some tenants require Company even w/ ApiKey)
  if (apiKeyEnv) {
    for (const c of [companyEnv, 'ConnectUs', ''].filter(v => v !== undefined)) {
      attempts.push({
        label: `API_KEY :: ${c ? `Company="${c}"` : 'no Company'}`,
        payload: {
          ...(c ? { Company: c } : {}),
          ApiKey: apiKeyEnv, Type: 1141, Filters: [], PageNumber: 1, NumberOfRecords: 1
        }
      });
    }
  }

  const results = [];
  for (const a of attempts) {
    try {
      const r = await tryOnce(a.label, a.payload);
      results.push({ label: a.label, ok: r.ok, status: r.status, err: r.ok ? undefined : r.preview });
      if (r.ok) break; // stop on first success
    } catch (e) {
      results.push({ label: a.label, ok:false, status: 0, err: String(e.message || e) });
    }
  }

  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({
    base,
    diag: {
      companyEnv: mask(companyEnv),
      usernameEnv: mask(usernameEnv),
      hasPassword: !!passwordEnv,
      apiKeyLen: apiKeyEnv ? apiKeyEnv.length : 0,
    },
    results
  }, null, 2));
};
