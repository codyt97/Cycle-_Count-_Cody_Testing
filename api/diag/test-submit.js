// api/diag/test-submit.js
// Purpose: Quickly verify Sheets logging (Bins + NotScanned) with SKU/Description.
// Usage (GET):
//   /api/diag/test-submit
//   /api/diag/test-submit?bin=BIN-TEST-01&counter=QA%20Tester&user=tester
// Optional overrides:
//   serialSku, serialDesc, serialImei,
//   nonSku, nonDesc, nonSysQty=5, nonQty=3

const Store = require("../_lib/store");
const { logBinSummary, logNotScannedMany } = require("../_lib/logs");

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(body));
}

function qp(req, key, def = "") {
  const v = req.query?.[key];
  if (v === undefined || v === null) return def;
  return Array.isArray(v) ? v[0] : String(v);
}

function nowISO() { return new Date().toISOString(); }
function rand(n = 6) { return Math.random().toString().slice(2, 2 + n); }

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET")     return json(res, 405, { ok:false, error:"method_not_allowed" });

  try {
    // ---- Defaults & overrides -----------------------------------
    const bin        = qp(req, "bin", `BIN-TEST-${new Date().toISOString().slice(0,10)}-${rand(4)}`);
    const counter    = qp(req, "counter", "QA Tester");
    const user       = qp(req, "user", "tester");

    const serialSku  = qp(req, "serialSku", "SM-T377TTW2");
    const serialDesc = qp(req, "serialDesc", "Galaxy Tab 8.0 (Verizon)");
    const serialImei = qp(req, "serialImei", `35${rand(12)}`); // fake IMEI-like

    const nonSku     = qp(req, "nonSku", "USB-CABLE-3FT");
    const nonDesc    = qp(req, "nonDesc", "3ft Type-C USB Cable");
    const nonSysQty  = Number(qp(req, "nonSysQty", "5")) || 5;
    const nonQty     = Number(qp(req, "nonQty", "3")) || 3;

    const total   = nonSysQty + 1; // one serial + non-serial qty baseline
    const scanned = nonQty;        // intentionally short + missing serial

    // ---- Build a realistic submission payload -------------------
    const items = [
      { // serial item, NOT scanned
        sku: serialSku,
        description: serialDesc,
        systemImei: serialImei,
        systemQty: 1,
        qtyEntered: 0
      },
      { // non-serial shortage
        sku: nonSku,
        description: nonDesc,
        systemQty: nonSysQty,
        qtyEntered: nonQty
      }
    ];

    const missingImeis = [{ systemImei: serialImei }];

    // ---- Persist app-side bin (so Investigator/Supervisor see it) ----
    const missingNonSerial = Math.max(0, nonSysQty - nonQty);
    const finalMissing = 1 + missingNonSerial; // 1 serial + NS deficit

    const payload = {
      user, bin, counter,
      total, scanned, missing: finalMissing,
      items,
      missingImeis,
      nonSerialShortages: [
        {
          sku: nonSku,
          description: nonDesc,
          systemQty: nonSysQty,
          qtyEntered: nonQty
        }
      ],
      state: finalMissing > 0 ? "investigation" : "complete",
      started: nowISO(),
      submittedAt: nowISO(),
    };

    await Store.upsertBin(payload);

    // ---- Sheets: Bins -------------------------------------------
    let binsResult = null;
    try {
      await logBinSummary({
        bin,
        counter,
        started: payload.started,
        updated: nowISO(),
        total,
        scanned,
        missing: finalMissing,
        state: payload.state,
      });
      binsResult = { ok:true };
    } catch (e) {
      binsResult = { ok:false, error: String(e?.message || e) };
    }

    // ---- Sheets: NotScanned (serial + non-serial with enrichment) ----
    // serial (enriched from items by IMEI)
    const serialRows = [{
      bin,
      sku: serialSku,
      description: serialDesc,
      systemQty: 1,
      qtyEntered: 0,
      missing: 1,
      createdAt: nowISO()
    }];
    // non-serial
    const nonSerialRows = [{
      bin,
      sku: nonSku,
      description: nonDesc,
      systemQty: nonSysQty,
      qtyEntered: nonQty,
      missing: missingNonSerial,
      createdAt: nowISO()
    }];

    let nsResult = null;
    try {
      await logNotScannedMany([...serialRows, ...nonSerialRows]);
      nsResult = { ok:true, appended: serialRows.length + nonSerialRows.length };
    } catch (e) {
      nsResult = { ok:false, error: String(e?.message || e) };
    }

    return json(res, 200, {
      ok: true,
      bin,
      submitted: { total, scanned, missing: finalMissing, state: payload.state },
      sheets: { bins: binsResult, notScanned: nsResult },
      sampleRows: { serialRows, nonSerialRows }
    });

  } catch (e) {
    return json(res, 500, { ok:false, error: String(e?.message || e) });
  }
};
