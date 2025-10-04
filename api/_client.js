// /api/ordertime/_client.js
function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
    headers["X-Api-Key"] = process.env.OT_API_KEY;
  } else if (process.env.OT_EMAIL && process.env.OT_PASSWORD) {
    const b64 = Buffer.from(`${process.env.OT_EMAIL}:${process.env.OT_PASSWORD}`).toString("base64");
    headers.Authorization = `Basic ${b64}`;
  }
  return headers;
}

function baseUrl() {
  const base = (process.env.OT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("OT_BASE_URL missing");
  return base;
}

// /api/ordertime/_client.js

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
    headers["X-Api-Key"] = process.env.OT_API_KEY;
  } else if (process.env.OT_EMAIL && process.env.OT_PASSWORD) {
    const b64 = Buffer.from(`${process.env.OT_EMAIL}:${process.env.OT_PASSWORD}`).toString("base64");
    headers.Authorization = `Basic ${b64}`;
  }
  return headers;
}

function baseUrl() {
  const base = (process.env.OT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("OT_BASE_URL missing");
  return base;
}

// Try multiple List paths until one returns 2xx JSON.
// You can override with OT_LIST_PATHS='["/Rest/List","/REST/List","/List","/Services/List","/v1/List"]'
async function otPostList(body) {
  const defaultCandidates = ["/List", "/list", "/REST/List", "/Rest/List", "/v1/List", "/Services/List"];
  let candidates = defaultCandidates;

  if (process.env.OT_LIST_PATHS) {
    try {
      const parsed = JSON.parse(process.env.OT_LIST_PATHS);
      if (Array.isArray(parsed) && parsed.length) candidates = parsed;
    } catch (_) { /* ignore bad JSON */ }
  } else if (process.env.OT_LIST_PATH) {
    candidates = [process.env.OT_LIST_PATH, ...defaultCandidates.filter(p => p !== process.env.OT_LIST_PATH)];
  }

  const errs = [];
  for (const path of candidates) {
    const url = `${baseUrl()}${path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body || {}),
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        errs.push(`OT ${res.status} at ${url}: ${text.slice(0,200)}`);
        continue;
      }
      try { return JSON.parse(text); }
      catch {
        errs.push(`Non-JSON at ${url}: ${text.slice(0,200)}`);
        continue;
      }
    } catch (e) {
      errs.push(`Fetch error at ${url}: ${String(e.message || e)}`);
    }
  }
  throw new Error(`All List paths failed:\n- ${errs.join("\n- ")}`);
}



