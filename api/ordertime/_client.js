// /api/ordertime/_client.js  (CommonJS)
/**
 * Env (Vercel → Settings → Environment Variables)
 *   OT_BASE_URL   = https://services.ordertime.com/api     (REQUIRED)
 *   OT_API_KEY    = ********                                (REQUIRED)
 *   OT_EMAIL      = you@company.com                         (REQUIRED)
 *   OT_DEVKEY     = ********                                (OPTIONAL, preferred)
 *   OT_PASSWORD   = ********                                (OPTIONAL, if no devkey)
 *   OT_LIST_PATH  = /List                                   (RECOMMENDED)
 *   OT_DEBUG      = 1                                       (OPTIONAL)
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

// Use PascalCase auth header names; some OT deployments are picky.
function authHeaders(){
  const { OT_API_KEY, OT_EMAIL, OT_DEVKEY, OT_PASSWORD } = process.env;
  if(!OT_API_KEY || !OT_EMAIL) throw new Error("Missing OT_API_KEY or OT_EMAIL");
  const headers = {
    "Content-Type": "application/json",
    ApiKey: OT_API_KEY,
    Email: OT_EMAIL,
  };
  if (OT_DEVKEY) headers.DevKey = OT_DEVKEY;
  else if (OT_PASSWORD) headers.Password = OT_PASSWORD;
  else dbg("WARN: neither OT_DEVKEY nor OT_PASSWORD set; auth may fail on some tenants");
  return headers;
}

function withTimeout(ms=DEFAULT_TIMEOUT_MS){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: ()=>clearTimeout(t) };
}

// ---- Body transformers for tenant quirks --------------------------
function swapFilterValueArrayToValues(body){
  const b = JSON.parse(JSON.stringify(body||{}));
  if (Array.isArray(b.Filters)) {
    b.Filters = b.Filters.map(f => {
      const g = { ...f };
      if (g.FilterValueArray && !g.FilterValues) {
        g.FilterValues = g.FilterValueArray;
        delete g.FilterValueArray;
      }
      return g;
    });
  }
  return b;
}
function wrapListRequest(body){ return { ListRequest: body }; }
function useRecordTypeKey(body){
  const b = JSON.parse(JSON.stringify(body||{}));
  if (b.Type != null && b.RecordType == null){
    b.RecordType = b.Type;
    delete b.Type;
  }
  return b;
}

// Returns an ordered list of candidate payloads to try
function payloadVariants(original){
  const variants = [];

  // 0) original
  variants.push({ label: "original", body: original });

  // 1) FilterValues
  const v1 = swapFilterValueArrayToValues(original);
  variants.push({ label: "FilterValues", body: v1 });

  // 2) ListRequest wrapper
  variants.push({ label: "ListRequest+original", body: wrapListRequest(original) });

  // 3) ListRequest + FilterValues
  variants.push({ label: "ListRequest+FilterValues", body: wrapListRequest(v1) });

  // 4) RecordType + FilterValues
  const v4 = useRecordTypeKey(v1);
  variants.push({ label: "RecordType+FilterValues", body: v4 });

  // 5) ListRequest + RecordType + FilterValues
  variants.push({ label: "ListRequest+RecordType+FilterValues", body: wrapListRequest(v4) });

  return variants;
}

// ---- Core List poster ------------------------------------------------
async function otPostList(body){
  const urlBase = baseUrl();
  const path = (process.env.OT_LIST_PATH || "/List").trim();
  const url = `${urlBase}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = authHeaders();

  const tries = payloadVariants(body);
  const errors = [];

  for (const attempt of tries){
    const payload = JSON.stringify(attempt.body || {});
    const to = withTimeout();

    try{
      dbg("POST", url, "variant:", attempt.label, "len:", payload.length);
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        cache: "no-store",
        signal: to.signal,
      });
      const text = await res.text();
      dbg("RES", res.status, "variant:", attempt.label);

      if (!res.ok){
        // Capture details
        errors.push(`OT ${res.status} [${attempt.label}] ${text.slice(0,300)}`);
        to.cancel();
        // If 4xx, try next shape; if 5xx, still try next but keep note
        continue;
      }

      try{
        const json = JSON.parse(text);
        to.cancel();
        return json;
      }catch(e){
        errors.push(`Non-JSON [${attempt.label}] ${text.slice(0,300)}`);
        to.cancel();
        continue;
      }
    }catch(e){
      const msg = e && e.name === "AbortError" ? "timeout" : String(e.message || e);
      errors.push(`Fetch error [${attempt.label}] ${msg}`);
      to.cancel();
      continue;
    }
  }

  throw new Error(`All List shapes failed:\n- ${errors.join("\n- ")}`);
}

module.exports = { authHeaders, otPostList };
