// api/inventory/rebuild-store.js
//
// Rebuild the Redis snapshot of inventory from Google Sheets.
// It reads the sheet via Google APIs (no public CSV needed) and writes:
//   inv:bins                -> JSON array of bin codes
//   inv:snapshot_at         -> ISO timestamp
//   inv:bin:<BIN>           -> JSON { bin, imeis: string[], nonserialQty: number }
//   inv:count:<BIN>         -> total count (imeis.length + nonserialQty)
//
// REQS (env):
//   REDIS_URL
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY        (with \n line breaks escaped)
//   INVENTORY_SHEET_ID
//   DRIVE_SHEET_TAB
//
// Call with GET (or POST):
//   https://<app>/api/inventory/rebuild-store
//
// Strong opinions: this nukes any previous inv:* keys and replaces them.

const { withCORS, ok, bad, method } = require("../_lib/respond");
const { google } = require("googleapis");
const IORedis = require("ioredis");

// --- helpers ---------------------------------------------------------------

function clean(s) { return String(s ?? "").trim(); }
function normBin(s) {
  return String(s || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
}

function idxOf(headers, candidates) {
  const h = headers.map(x => String(x || "").toLowerCase().trim());
  for (const c of candidates) {
    const i = h.indexOf(String(c).toLowerCase().trim());
    if (i >= 0) return i;
  }
  return -1;
}

async function unlinkByPrefix(redis, prefix) {
  // Non-blocking sweep of all keys with a prefix
  let cursor = "0";
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", "1000");
    cursor = next;
    if (keys && keys.length) {
      // UNLINK is non-blocking; fall back to DEL if not supported
      try {
        removed += await redis.unlink(keys);
      } catch {
        removed += await redis.del(keys);
      }
    }
  } while (cursor !== "0");
  return removed;
}

// --- handler ---------------------------------------------------------------

module.exports = withCORS(async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return method(res, "GET, POST");
  }

  const REDIS_URL = process.env.REDIS_URL;
  const SHEET_ID = process.env.INVENTORY_SHEET_ID;
  const TAB = process.env.DRIVE_SHEET_TAB || "Inventory";
  if (!REDIS_URL) return bad(res, "Missing REDIS_URL");
  if (!SHEET_ID) return bad(res, "Missing INVENTORY_SHEET_ID");

  // 1) Read rows from Google Sheets
  const auth = getJwt();
  const sheets = google.sheets({ version: "v4", auth });
  const range = `${TAB}!A:ZZ`;
  const g = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension: "ROWS",
  });
  const values = g.data.values || [];
  if (!values.length) return bad(res, `No rows returned from sheet '${TAB}'`);

  const headers = (values[0] || []).map(x => String(x || "").trim());
  const rows = values.slice(1);

  // Column detection (be generous with names)
  const binIdx = idxOf(headers, [
    "bin", "bin location", "bin#", "bin id", "location", "bin code"
  ]);
  if (binIdx < 0) return bad(res, `Could not find BIN column in tab '${TAB}'`);

  const imeiIdx = idxOf(headers, [
    "imei", "serial", "serialnumber", "sn", "esn", "meid"
  ]);

  const qtyIdx = idxOf(headers, ["qty", "quantity", "on hand", "count"]);

  // 2) Aggregate by bin
  const bins = new Map(); // BIN -> { imeis:Set, qty:number }
  for (const r of rows) {
    const bin = normBin(r[binIdx]);
    if (!bin) continue;

    if (!bins.has(bin)) bins.set(bin, { imeis: new Set(), qty: 0 });

    const imei = imeiIdx >= 0 ? clean(r[imeiIdx]) : "";
    const qty = qtyIdx >= 0 ? Number(r[qtyIdx] || 0) : 0;

    if (imei) {
      bins.get(bin).imeis.add(imei);
    } else if (qty && Number.isFinite(qty)) {
      bins.get(bin).qty += qty; // treat non-serial quantities
    }
  }

  // 3) Connect Redis
  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });

  const prefix = process.env.REDIS_PREFIX || "inv:";
  // 4) Clear previous snapshot
  await unlinkByPrefix(redis, prefix);

  // 5) Write fresh snapshot
  const allBins = Array.from(bins.keys());
  const now = new Date().toISOString();

  await redis.set(`${prefix}bins`, JSON.stringify(allBins), "EX", 60 * 60 * 24); // 24h ttl (optional)
  await redis.set(`${prefix}snapshot_at`, now);

  for (const [bin, info] of bins.entries()) {
    const payload = {
      bin,
      imeis: Array.from(info.imeis),
      nonserialQty: info.qty || 0,
    };
    await redis.set(`${prefix}bin:${bin}`, JSON.stringify(payload));
    await redis.set(`${prefix}count:${bin}`, String(payload.imeis.length + (payload.nonserialQty || 0)));
  }

  // 6) return summary
  return ok(res, {
    ok: true,
    bins: allBins.length,
    snapshot_at: now,
    prefix,
  });
});
