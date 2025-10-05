/* eslint-disable no-console */

// --------- Config via environment (with safe defaults) ----------
const OT_DEBUG = (process.env.OT_DEBUG || "0") === "1";

// Base URL: e.g. "https://services.ordertime.com"  OR  "https://services.ordertime.com/api"
const OT_BASE_URL = (process.env.OT_BASE_URL || "https://services.ordertime.com").trim();

// Try these paths in order; code will join with URL(), so no /api/api problems.
const OT_LIST_PATHS = readArrayEnv("OT_LIST_PATHS", ["/api/List", "/List"]);

// Which property holds the bin/location bin name.
const OT_BIN_PROP = process.env.OT_BIN_PROP || "LocationBinRef.Name";

// Location field and allowed values for the “IN” filter (your KOP & 3PL ask).
const OT_LOCATION_FIELD = process.env.OT_LOCATION_FIELD || "LocationRef.Name";
const OT_LOCATION_VALUES = readArrayEnv("OT_LOCATION_VALUES", ["KOP", "3PL"]);

// Page size (keep it ≤ 500 to avoid long responses)
const OT_LIST_PAGE_SIZE = toInt(process.env.OT_LIST_PAGE_SIZE, 500);

// Numeric record “Type” candidates to try; keep integers only.
const OT_SERIAL_TYPES = readArrayEnv("OT_SERIAL_TYPES", [1100, 1101, 1200, 1201]).map(toInt);

// Credentials (OrderTime usually accepts Basic + API key; keep any that apply).
const OT_API_KEY = (process.env.OT_API_KEY || "").trim();
const OT_EMAIL = (process.env.OT_EMAIL || "").trim();
const OT_PASSWORD = (process.env.OT_PASSWORD || "").trim();

// Per-call timeout (ms). Keep this well under Vercel’s 5s total. We’ll try few variants quickly.
const CALL_TIMEOUT_MS = toInt(process.env.OT_CALL_TIMEOUT_MS, 1200);

// Max attempts guardrail
const MAX_TOTAL_ATTEMPTS = toInt(process.env.OT_MAX_ATTEMPTS, 10);

// ----------------------------------------------------------------

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const bin = (req.query.bin || "").toString().trim();
    if (!bin) return res.status(400).json({ error: "Missing ?bin=…" });

    // quick debug banner
    dbg("[bin] params", {
      bin,
      pageSize: OT_LIST_PAGE_SIZE,
      forcedProp: OT_BIN_PROP,
      locationField: OT_LOCATION_FIELD,
      locationValues: OT_LOCATION_VALUES,
      types: OT_SERIAL_TYPES,
      listPaths: OT_LIST_PATHS,
    });

    // Build filters: Bin equals + Location IN [KOP,3PL]
    const baseFilters = [
      {
        PropertyName: OT_BIN_PROP,
        FilterOperation: "Equals",
        Value: bin,
      },
      {
        PropertyName: OT_LOCATION_FIELD,
        FilterOperation: "In",
        Values: OT_LOCATION_VALUES,
      },
    ];

    // Body variants to try (two canonical shapes the API accepts)
    const buildBodies = (type, pageNo, pageSize) => ([
      // canonical #1
      {
        Type: type,
        Filters: baseFilters,
        PageNumber: pageNo,
        NumberOfRecords: pageSize,
      },
      // canonical #2 with PageNo/PageSize naming
      {
        Type: type,
        Filters: baseFilters,
        PageNo: pageNo,
        PageSize: pageSize,
      },
    ]);

    const headers = makeHeaders();

    // Try each path, each type, and each body shape until one answers 200.
    let attempts = 0;
    let lastErr = null;

    for (const listPath of OT_LIST_PATHS) {
      for (const type of OT_SERIAL_TYPES) {
        // paginate until exhausted for the first body that returns 200
        for (const bodyVariant of buildBodies(type, 1, OT_LIST_PAGE_SIZE)) {
          attempts++;
          if (attempts > MAX_TOTAL_ATTEMPTS) throw lastErr || new Error("Exceeded max attempts");

          let page = 1;
          const allRows = [];

          try {
            while (true) {
              const body = { ...bodyVariant };
              if ("PageNumber" in body) body.PageNumber = page;
              if ("PageNo" in body) body.PageNo = page;

              const { ok, status, data, text, url, tooSlow } = await postJsonOnce(
                joinSmart(OT_BASE_URL, listPath),
                body,
                headers,
                CALL_TIMEOUT_MS
              );

              dbg(`[OT] POST ${url} type:${type} bodyShape:${shapeName(bodyVariant)} page:${page} -> ${status}${tooSlow ? " (timeout)" : ""}`);

              if (status === 404) {
                // wrong path – try next path immediately
                throw markPathError(new Error(text || "404 Not Found"));
              }

              if (!ok) {
                // 4xx/5xx: keep trying other shapes/types/paths, but bail this inner loop
                const msg = safeErrMsg(data, text);
                throw new Error(msg);
              }

              const rows = Array.isArray(data?.Items) ? data.Items
                         : Array.isArray(data?.items) ? data.items
                         : Array.isArray(data?.Data)  ? data.Data
                         : Array.isArray(data)        ? data
                         : [];

              allRows.push(...rows);

              // break if we got less than page size or no pagination fields
              const got = rows.length;
              const wanted = ("NumberOfRecords" in body) ? body.NumberOfRecords
                             : ("PageSize" in body) ? body.PageSize
                             : OT_LIST_PAGE_SIZE;

              if (!got || got < wanted) break; // exhausted
              page++;
            }

            // success path
            return res.status(200).json({
              bin,
              total: allRows.length,
              rows: allRows,
            });

          } catch (e) {
            lastErr = e;

            // If it was a path problem, break to next path.
            if (isPathError(e)) break;

            // Otherwise, try next body variant/type
            continue;
          }
        } // body variants
      } // types
    } // paths

    throw lastErr || new Error("OrderTime did not return data");

  } catch (err) {
    console.error(err);
    // Keep the message tight to avoid leaking internals
    return res.status(502).json({
      error: "BIN API 502",
      message: err?.message || "Upstream error",
    });
  }
}

// ------------------------- helpers ------------------------------

function readArrayEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    // allow JSON like '["/api/List","/List"]'
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  // or comma-separated
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function toInt(v, d) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

function dbg(...args) {
  if (OT_DEBUG) console.log(...args);
}

// Construct URL safely (no double /api)
function joinSmart(base, path) {
  try {
    // new URL handles absolute/relative joining correctly
    const u = new URL(path, ensureEndsWithSlash(base));
    return u.href;
  } catch {
    // ultra conservative fallback
    const b = base.replace(/\/+$/, "");
    const p = String(path || "").replace(/^\/+/, "");
    return `${b}/${p}`;
  }
}

function ensureEndsWithSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

function makeHeaders() {
  const h = { "Content-Type": "application/json" };

  // Many OrderTime setups require Basic auth + API key header.
  if (OT_EMAIL && OT_PASSWORD) {
    const b64 = Buffer.from(`${OT_EMAIL}:${OT_PASSWORD}`).toString("base64");
    h.Authorization = `Basic ${b64}`;
  }

  if (OT_API_KEY) {
    // support a few common header names
    h["X-API-KEY"] = OT_API_KEY;
    h["x-api-key"] = OT_API_KEY;
    h["OT-API-Key"] = OT_API_KEY;
  }

  return h;
}

async function postJsonOnce(url, body, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let tooSlow = false;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const txt = await resp.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (_) {}

    return {
      ok: resp.ok,
      status: resp.status,
      text: txt,
      data,
      url,
      tooSlow,
    };
  } catch (e) {
    if (e.name === "AbortError") {
      tooSlow = true;
      return { ok: false, status: 599, text: "timeout", data: null, url, tooSlow };
    }
    return { ok: false, status: 598, text: e?.message || "network error", data: null, url, tooSlow };
  } finally {
    clearTimeout(timer);
  }
}

function shapeName(body) {
  if ("PageNumber" in body) return "PageNumber/NumberOfRecords";
  if ("PageNo" in body) return "PageNo/PageSize";
  return "unknown";
}

function safeErrMsg(json, text) {
  if (json && typeof json === "object") {
    if (typeof json.Message === "string") return json.Message;
    if (typeof json.error === "string") return json.error;
    if (typeof json.message === "string") return json.message;
  }
  return text || "Upstream error";
}

function markPathError(err) { err.__isPathError = true; return err; }
function isPathError(err) { return !!err?.__isPathError; }
