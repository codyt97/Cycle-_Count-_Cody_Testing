// api/cyclecounts/not-scanned.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

const norm = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();

/** Build a Sheets client from GOOGLE_CREDENTIALS_JSON */
function getSheets() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  let creds;
  try { creds = JSON.parse(raw); } catch { throw new Error("GOOGLE_CREDENTIALS_JSON is not valid JSON"); }
  const key = String(creds.private_key || "").replace(/\r?\n/g, "\n");
  if (!creds.client_email || !key) throw new Error("Bad GOOGLE_CREDENTIALS_JSON: missing client_email/private_key");
  const auth = new google.auth.JWT(creds.client_email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

/**
 * GET: Return not-scanned items across bins.
 * Logic: For each bin in Store, include rows where:
 *  - serial item: qtyEntered < 1
 *  - non-serial:  qtyEntered < systemQty
 */
async function handleGet(req, res) {
  try {
    const bins = await Store.listBins(); // [{ bin, counter, items:[{sku,description,systemImei,systemQty,qtyEntered}]}]
    const out = [];
    for (const b of (bins || [])) {
      const binName = norm(b.bin);
      const counter = norm(b.counter || "");
      for (const it of (b.items || [])) {
        const sku         = norm(it.sku);
        const description = norm(it.description);
        const systemImei  = norm(it.systemImei);
        const systemQty   = Number.isFinite(it.systemQty) ? it.systemQty : (systemImei ? 1 : 0);
        const qtyEntered  = Number(it.qtyEntered || 0);
        const isSerial    = !!systemImei;

        const missingQty  = isSerial ? (qtyEntered < 1 ? 1 : 0) : Math.max(0, systemQty - qtyEntered);
        if (missingQty > 0) {
          out.push({
            bin: binName,
            counter,
            type: isSerial ? "serial" : "non-serial",
            sku,
            description,
            systemImei,
            systemQty,
            qtyEntered,
          });
        }
      }
    }
    return ok(res, { records: out });
  } catch (e) {
    console.error("[not-scanned][GET] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
}

/**
 * DELETE: Mark a not-scanned item resolved.
 * Accepts body or query:
 *   - { bin, imei }  -> marks that serial as found (qtyEntered = 1)
 *   - { bin, sku, qtyEntered } -> updates entered quantity for non-serial
 */
async function handleDelete(req, res) {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
let bin     = norm(body.bin || req.query?.bin || "");     // <-- note: 'let' so we can fill it
const imei  = norm(body.systemImei || body.imei || req.query?.imei || "");
const sku   = norm(body.sku || req.query?.sku || "");
const entered = Number(body.qtyEntered != null ? body.qtyEntered : req.query?.qtyEntered) || 0;
const user    = norm(body.user || body.counter || req.query?.user || "");

// must have at least imei or sku
if (!imei && !sku) return bad(res, "systemImei or sku is required", 400);

// infer bin by IMEI if caller didn’t send bin
if (!bin && imei) {
  const all = await Store.listBins();
  const hit = (all || []).find(x =>
    (x.items || []).some(it => String(it.systemImei || "").trim() === imei)
  );
  bin = hit?.bin || "";
}

// still no bin? bail with same error
if (!bin) return bad(res, "bin is required", 400);


    const updated = await Store.upsertBin(bin, (b) => {
      const items = Array.isArray(b.items) ? [...b.items] : [];
      let changed = false;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const isSerial = !!it.systemImei;

        if (imei && isSerial && String(it.systemImei).trim() === imei) {
          items[i] = { ...it, qtyEntered: 1, updatedAt: nowISO(), updatedBy: user || (b.counter || "—") };
          changed = true; break;
        }
        if (!imei && sku && !isSerial && String(it.sku).trim() === sku) {
          const sys = Number.isFinite(it.systemQty) ? it.systemQty : 0;
          const val = Math.max(0, Math.min(sys, Number(entered || 0)));
          items[i] = { ...it, qtyEntered: val, updatedAt: nowISO(), updatedBy: user || (b.counter || "—") };
          changed = true; break;
        }
      }

      return changed ? { ...b, items, updatedAt: nowISO() } : b;
    });

    // Optional audit to Sheets (best-effort, non-blocking)
    try {
      if (process.env.LOGS_SHEET_ID) {
        const ts = nowISO();
        const values = [
          ts, bin, (imei || sku || "—"), user || "—",
          imei ? "serial-resolved" : "nonserial-updated",
          entered || (imei ? 1 : 0),
        ];
        await appendRow(process.env.LOGS_SHEET_ID, "NotScannedAudit", values);
      }
    } catch (e) {
      console.error("[not-scanned][DELETE] audit append fail:", e?.message || e);
    }

    return ok(res, { ok: true, bin: updated?.bin || bin });
  } catch (e) {
    console.error("[not-scanned][DELETE] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method === "DELETE")  { withCORS(res); return handleDelete(req, res); }
  if (req.method === "GET")     { withCORS(res); return handleGet(req, res); }
  return method(res, ["GET","DELETE","OPTIONS"]);
};
