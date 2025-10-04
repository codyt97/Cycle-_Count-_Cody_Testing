// /api/ordertime/_client.js  (CommonJS, Node runtime)
/**
 * Env (Vercel → Settings → Environment Variables)
 *   OT_BASE_URL   = https://services.ordertime.com/api    (REQUIRED)
 *   OT_API_KEY    = <your api key>                        (REQUIRED)
 *   OT_EMAIL      = <your user email>                     (REQUIRED)
 *   OT_DEVKEY     = <your dev key>                        (OPTIONAL, preferred over password)
 *   OT_PASSWORD   = <your user password>                  (OPTIONAL, only if no dev key)
 *   OT_LIST_PATH  = /List                                 (RECOMMENDED)
 *   OT_DEBUG      = 1                                     (OPTIONAL)
 */
const DEFAULT_TIMEOUT_MS = 15000;

function dbg(...args){ if(process.env.OT_DEBUG) try{ console.log("[OT]", ...args); }catch(_){} }

function baseUrl(){
  const raw = (process.env.OT_BASE_URL || "").trim();
  if(!raw) throw new Error("OT_BASE_URL missing");
  const url = raw.replace(/\/+$/,"");
  if(!/^https?:\/\//i.test(url)) throw new Error(`OT_BASE_URL must include http(s): ${raw}`);
  return url;
}

// IMPORTANT: Use PascalCase header names. Some OT deployments are picky.
function authHeaders(){
  const { OT_API_KEY, OT_EMAIL, OT_DEVKEY, OT_PASSWORD } = process.env;
  if(!OT_API_KEY || !OT_EMAIL){
    throw new Error("Missing OT_API_KEY or OT_EMAIL");
  }
  const headers = {
    "Content-Type": "application/json",
    ApiKey: OT_API_KEY,
    Email: OT_EMAIL,
  };
  // Prefer dev key; fall back to password if provided.
  if(OT_DEVKEY) headers.DevKey = OT_DEVKEY;
  else if(OT_PASSWORD) headers.Password = OT_PASSWORD;
  else dbg("WARN: neither OT_DEVKEY nor OT_PASSWORD set; auth may fail on some tenants");

  // Do NOT set Authorization / X-Api-Key for OT /List.
  return headers;
}

/**
 * POST to OrderTime List endpoint with {Type, Filters, PageNumber, NumberOfRecords}
 */
async function otPostList(body){
  const errs = [];
  const urlBase = baseUrl();
  const path = (process.env.OT_LIST_PATH || "/List").trim();
  const url = `${urlBase}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = authHeaders();
  const payload = JSON.stringify(body || {});

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  try{
    dbg("POST", url, "hdrs:", Object.keys(headers).join(","), "len:", payload.length);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: payload,
      cache: "no-store",
      signal: ctrl.signal,
    });
    const text = await res.text();
    dbg("RES", url, res.status);

    if(!res.ok){
      throw new Error(`OT ${res.status} at ${url}: ${text.slice(0,300)}`);
    }
    try{
      return JSON.parse(text);
    }catch(e){
      throw new Error(`Non-JSON at ${url}: ${text.slice(0,300)}`);
    }
  }catch(e){
    errs.push(String(e.message || e));
    throw new Error(`All List paths failed:\n- ${errs.map(s=>s.replace(/\n/g," ")).join("\n- ")}`);
  }finally{
    clearTimeout(t);
  }
}

module.exports = { authHeaders, otPostList };
