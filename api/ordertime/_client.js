// /api/ordertime/_client.js  (CommonJS, Node runtime)
/**
 * OrderTime REST client for serverless routes.
 *
 * Expected Vercel env vars:
 *   OT_BASE_URL   = https://services.ordertime.com/api      (REQUIRED)
 *   OT_API_KEY    = <your api key>                          (REQUIRED)
 *   OT_EMAIL      = <user email>                            (REQUIRED)
 *   OT_DEVKEY     = <optional dev key>
 *   OT_LIST_PATH  = /List                                   (optional, pins a single path)
 *   OT_LIST_PATHS = ["...","..."]                           (optional, JSON array of candidates)
 *   OT_LIST_PAGE_SIZE = 500                                 (optional, used in callers)
 *   OT_DEBUG      = 1                                       (optional, logs non-sensitive info)
 */

const DEFAULT_TIMEOUT_MS = 15000; // 15s

function debug(...args) {
  if (process.env.OT_DEBUG) {
    // Never print secrets
    try { console.log("[OT]", ...args); } catch (_) {}
  }
}

/** Build the API base URL */
function baseUrl() {
  const raw = (process.env.OT_BASE_URL || "").trim();
  if (!raw) throw new Error("OT_BASE_URL missing");
  // normalize: ensure it starts with http(s) and has no trailing slash
  const url = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`OT_BASE_URL must include protocol, got: ${raw}`);
  }
  return url;
}

/** Compose required OrderTime headers */
function authHeaders() {
  const { OT_API_KEY, OT_EMAIL, OT_DEVKEY } = process.env;

  if (!OT_API_KEY || !OT_EMAIL) {
    throw new Error("Missing OT_API_KEY or OT_EMAIL env vars");
  }

  // OrderTime REST expects these exact header names.
  const headers = {
    "Content-Type": "application/json",
    apiKey: OT_API_KEY,
    email: OT_EMAIL,
  };

  if (OT_DEVKEY) headers.devKey = OT_DEVKEY;

  // DO NOT set Authorization/X-Api-Key for OT REST; not required for /List.
  return headers;
}

/**
 * POST to OrderTime List endpoint and return parsed JSON.
 * - Supports pinning a single known-good path via OT_LIST_PATH.
 * - Or tries multiple candidate paths, including those in OT_LIST_PATHS (JSON).
 * - Adds per-request timeout & safe debug logs.
 *
 * @param {object} body - List request body { Type, Filters, PageNumber, NumberOfRecords, ... }
 * @returns {Promise<object>} parsed JSON from OT
 */
async function otPostList(body) {
  const errs = [];

  // Candidate path resolution
  const defaultCandidates = ["/List", "/list", "/REST/List", "/Rest/List", "/v1/List", "/Services/List"];

  let candidates = defaultCandidates;
  if (process.env.OT_LIST_PATH && process.env.OT_LIST_PATH.trim()) {
    // Pin a single path (preferred if your tenant is known)
    candidates = [process.env.OT_LIST_PATH.trim()];
  } else if (process.env.OT_LIST_PATHS) {
    try {
      const parsed = JSON.parse(process.env.OT_LIST_PATHS);
      if (Array.isArray(parsed) && parsed.length) {
        candidates = parsed.map(s => String(s).trim()).filter(Boolean);
      }
    } catch (e) {
      errs.push(`Bad OT_LIST_PATHS JSON: ${String(e.message || e)}`);
    }
  }

  const urlBase = baseUrl();
  const headers = authHeaders();
  const payload = JSON.stringify(body || {});

  for (const path of candidates) {
    const url = `${urlBase}${path.startsWith("/") ? path : `/${path}`}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

    try {
      debug("POST", url, "body:length=", payload.length);

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: payload,
        cache: "no-store",
        signal: ctrl.signal,
      });

      const text = await res.text(); // OT sometimes returns text for errors
      debug("RES", url, res.status);

      if (!res.ok) {
        errs.push(`OT ${res.status} at ${url}: ${text.slice(0, 300)}`);
        clearTimeout(t);
        continue; // try next candidate
      }

      try {
        const json = JSON.parse(text);
        clearTimeout(t);
        return json;
      } catch (e) {
        errs.push(`Non-JSON at ${url}: ${text.slice(0, 300)}`);
        clearTimeout(t);
        continue;
      }
    } catch (e) {
      const msg = e && e.name === "AbortError" ? "timeout" : String(e.message || e);
      errs.push(`Fetch error at ${url}: ${msg}`);
      clearTimeout(t);
      // try next candidate
    }
  }

  // If we got here, all candidates failed.
  throw new Error(`All List paths failed:\n- ${errs.join("\n- ")}`);
}

module.exports = { authHeaders, otPostList };
