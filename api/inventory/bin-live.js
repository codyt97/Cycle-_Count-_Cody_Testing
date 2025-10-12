/* eslint-disable no-console */
// api/inventory/bin-live.js  (robust: Google Sheet OR Excel/CSV on Drive; header-agnostic)
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

let cache = { at: 0, tab: "", rows: [] };
const TTL_MS = 30_000;

const clean = (s) => String(s ?? "").trim();
const normBin = (s) =>
  String(s || "")
    .replace(/\u2013|\u2014/g, "-") // en/em dash
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
}
const sheetsClient = () => google.sheets({ version: "v4", auth: getJwt() });
const driveClient  = () => google.drive({ version: "v3", auth: getJwt() });

// extract first integer-ish number (handles "4 EA" / "4,000")
function numLoose(s) {
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// Try to find a bin-like token in a cell (e.g., C-05-04, A-1-02, etc.)
function findBinInCell(text) {
  const t = normBin(text);
  // Common rack/bin formats: L-##-##, ##-##-##, L-###, etc. Tolerate A1-01-02 too.
  const m = t.match(/\b[A-Z]?-?\d{1,3}-\d{1,3}(?:-\d{1,3})?\b/);
  return m ? m[0] : "";
}

// Extract 11–17 consecutive digits for IMEI/serial/MEID-like values
function extractSerial(text) {
  const m = String(text ?? "").replace(/\s+/g, "").match(/\d{11,17}/);
  return m ? m[0] : "";
}

function normalizeFromValues(values, requestedBin) {
  if (!Array.isArray(values) || !values.length) return { tab: "", rows: [] };
  const rowsOut = [];

  // If the first row is headers, keep it, but don’t rely on names—scan every cell anyway.
  const dataRows = values.slice(1); // keep as header-ish for debugging if needed

  const want = normBin(requestedBin);

  for (const r of dataRows) {
    if (!Array.isArray(r)) continue;

    let location = "";
    let systemImei = "";
    let sku = "";
    let description = "";
    let qty = 0;

    // pass 1: try to find an explicit matching bin in any cell
    for (const cell of r) {
      const b = findBinInCell(cell);
      if (b && normBin(b) === want) {
        location = b;
        break;
      }
    }
    // pass 2: if not exact, see if any cell contains the bin token (contains)
    if (!location) {
      for (const cell of r) {
        const b = findBinInCell(cell);
        if (b && normBin(b).includes(want)) {
          location = b;
          break;
        }
        // also allow the reverse: cell equals want w/ stray spaces/dashes already normalized
        if (normBin(cell) === want) {
          location = cell;
          break;
        }
      }
    }

    // if no matching bin in this row, skip early to keep the set tight
    if (!location) continue;

    // pass 3: find IMEI/serial anywhere in the row
    for (const cell of r) {
      const s = extractSerial(cell);
      if (s) { systemImei = s; break; }
    }

    // pass 4: try to recover sku/description/qty heuristically (best-effort)
    // sku: any non-empty token with letters+digits (code-y) that is not the IMEI
    for (const cell of r) {
      const t = clean(cell);
      if (!t) continue;
      // skip if it is just the imei
      if (t.replace(/\D+/g, "") === systemImei) continue;
      // a code-like token (letters+digits) and not looking like a date or bin
      if (/[A-Za-z]/.test(t) && /\d/.test(t) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) && !findBinInCell(t)) {
        sku = sku || t;
      }
    }
    // description: prefer the longest non-empty, human-ish string that isn't sku/imei/bin
    let bestDesc = "";
    for (const cell of r) {
      const t = clean(cell);
      if (!t) continue;
      const digitsOnly = t.replace(/\D+/g, "");
      if (digitsOnly === systemImei) continue;
      if (normBin(t) === want) continue;
      // not just a code
      if (!/[A-Za-z]{3,}/.test(t)) continue;
      if (t.length > bestDesc.length) bestDesc = t;
    }
    description = bestDesc;

    // qty: pick the largest plausible integer in the row for non-serial items (fallback 1 if we have IMEI)
    let bestQty = 0;
    for (const cell of r) {
      const n = numLoose(cell);
      if (Number.isFinite(n) && n > bestQty) bestQty = n;
    }
    qty = systemImei ? 1 : bestQty || 0;

    rowsOut.push({
      location,
      sku,
      description,
      systemImei,
      hasSerial: !!systemImei,
      systemQty: systemImei ? 1 : Number(qty || 0),
    });
  }

  return { tab: "", rows: rowsOut };
}

async function loadFromGoogleSheet(spreadsheetId, requestedBin) {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabEnv = clean(process.env.DRIVE_SHEET_TAB || "");
  let tab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  if (tabEnv) {
    const hit = meta.data.sheets?.find((s) => clean(s.properties?.title).toLowerCase() === tabEnv.toLowerCase());
    if (hit) tab = hit.properties.title;
  }
  const range = `${tab}!A1:Z100000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  const out = normalizeFromValues(values, requestedBin);
  return { tab, rows: out.rows };
}

async function loadFromDriveFile(fileId, requestedBin) {
  const drive = driveClient();
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const mime = meta.data.mimeType || "";
  const name = meta.data.name || "";

  // Google Sheet on Drive → export CSV
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb  = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    const tab = process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB]
      ? process.env.DRIVE_SHEET_TAB
      : wb.SheetNames[0];
    // IMPORTANT: raw:false to keep formatted strings (avoid 3.56E+14)
    const values = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false });
    const out = normalizeFromValues(values, requestedBin);
    return { tab, rows: out.rows, name, mime };
  }

  // XLSX/CSV binary on Drive
  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const looksText = name.toLowerCase().endsWith(".csv") || /^text\//.test(mime);
  const wb = looksText ? XLSX.read(buf.toString("utf8"), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  const tab = process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB]
    ? process.env.DRIVE_SHEET_TAB
    : wb.SheetNames[0];

  const values = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false });
  const out = normalizeFromValues(values, requestedBin);
  return { tab, rows: out.rows, name, mime };
}

async function loadUnified(fileId, requestedBin) {
  if (Date.now() - cache.at < TTL_MS && cache.rows.length) return cache;

  // Try Sheets API first
  try {
    const hit = await loadFromGoogleSheet(fileId, requestedBin);
    cache = { at: Date.now(), ...hit };
    return cache;
  } catch (_) { /* fall back */ }

  const hit = await loadFromDriveFile(fileId, requestedBin);
  cache = { at: Date.now(), ...hit };
  return cache;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);
  withCORS(res);

  const fileId = clean(process.env.DRIVE_FILE_ID);
  if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);

  const binRaw = clean(req.query.bin || "");
  if (!binRaw) return bad(res, "bin is required", 400);

  try {
    const { rows, tab } = await loadUnified(fileId, binRaw);
    const want = normBin(binRaw);

    // final filtering in case heuristic found a different bin in row
    let hits = rows.filter((r) => normBin(r.location) === want);
    if (!hits.length) hits = rows.filter((r) => normBin(r.location).includes(want));

    const records = hits.map((r) => ({
      location: r.location,
      sku: r.sku,
      description: r.description,
      systemImei: r.systemImei,
      hasSerial: r.hasSerial,
      systemQty: Number(r.systemQty || 0),
    }));

    if (req.query.debug === "1") {
      const sampleBins = Array.from(new Set(rows.map((r) => r.location))).slice(0, 50);
      return ok(res, {
        records,
        meta: {
          tab,
          totalRows: rows.length,
          want,
          sampleBins,
          firstRowSample: rows.slice(0, 3),
        },
      });
    }

    return ok(res, { records, meta: { tab, totalRows: rows.length, cachedMs: Math.max(0, TTL_MS - (Date.now() - cache.at)) } });
  } catch (e) {
    console.error("[bin-live] read error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
