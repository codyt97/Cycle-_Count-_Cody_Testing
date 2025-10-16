// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

const clean = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const imei = clean(req.query.imei);
    const scannedBin = clean(req.query.scannedBin || req.query.bin);
    const scannedBy = clean(req.query.scannedBy || req.query.user || "");

    if (!imei || !scannedBin) return bad(res, "imei and scannedBin are required", 400);

    let matched = false;

    // Upsert inside the scanned bin (serial -> qtyEntered = 1)
    // Upsert inside the scanned bin (serial -> qtyEntered = 1) — robust match
await Store.upsertBin(scannedBin, (b) => {
  if (!b || !Array.isArray(b.items)) return b;

  const DIGITS = s => String(s ?? "").replace(/\D+/g, "").trim();
  const target = DIGITS(imei);
  const isMatch = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    // 14 vs 15 (or minor variant) → treat as match if one ends with the other
    if (a.length >= 14 && b.length >= 14) return a.endsWith(b) || b.endsWith(a);
    return false;
  };

  const items = b.items.map((it) => {
    const cand = DIGITS(it.systemImei);
    if (isMatch(cand, target)) {
      matched = true;
      return {
        ...it,
        qtyEntered: 1,
        updatedAt: nowISO(),
        updatedBy: scannedBy || (b.counter || "—"),
      };
    }
    return it;
  });
  return { ...b, items, updatedAt: nowISO() };
});


// If not matched, find true bin so UI can show it — search CC bins, then full inventory
let expectedBin = "";
if (!matched) {
  const DIGITS = s => String(s ?? "").replace(/\D+/g, "").trim();
  const target = DIGITS(imei);

  // helper: tolerant equality (14 vs 15)
  const isMatch = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 14 && b.length >= 14) return a.endsWith(b) || b.endsWith(a);
    return false;
  };
  // helper: extract all IMEI-like sequences from a blob
  const grabAllImeiLike = s => (String(s ?? "").match(/\d{12,}/g) || []).map(DIGITS);

  // 1) search in cycle-count bins (fast path)
  const ccBins = await Store.listBins();
  let hitBin = (ccBins || []).find(bin => {
    const items = bin.items || [];
    for (const it of items) {
      // common fields where IMEI might live
      const fields = [it.systemImei, it.imei, it.serial, it.imeis, it.imei1, it.imei2, it.note, it.notes, it.comment];
      for (const f of fields) {
        // split multi-IMEI cells and check each
        for (const cand of grabAllImeiLike(f)) {
          if (isMatch(cand, target)) return true;
        }
        if (isMatch(DIGITS(f), target)) return true;
      }
    }
    return false;
  });

  // 2) fallback: search the full inventory snapshot (covers items not in CC bins)
  if (!hitBin) {
    const inv = await Store.getInventory(); // rows with location + IMEI fields
    const row = (inv || []).find(r => {
      const fields = [r.systemImei, r.imei, r.serial, r.imeis, r.imei1, r.imei2, r.notes, r.comment, r.description];
      for (const f of fields) {
        for (const cand of grabAllImeiLike(f)) {
          if (isMatch(cand, target)) return true;
        }
        if (isMatch(DIGITS(f), target)) return true;
      }
      return false;
    });

    if (row) {
      // map common location keys
      expectedBin =
        row.location || row.bin || row.BIN || row.Bin || row.Location || row['Bin Location'] || "";
    }
  } else {
    expectedBin = hitBin.bin || "";
  }

  // audit (still useful even when not found)
  try {
    if (process.env.LOGS_SHEET_ID) {
      await appendRow(process.env.LOGS_SHEET_ID, "WrongBin", [
        nowISO(), imei, scannedBin, expectedBin || "—", scannedBy || "—"
      ]);
    }
  } catch (e) { console.error("[imei] audit append fail:", e?.message || e); }
}



    // Back-compat + normalized fields the UI expects
const found = !!expectedBin;
return ok(res, {
  ok: true,
  match: matched,
  imei,
  scannedBin,
  expectedBin,
  // New normalized fields:
  found,
  location: expectedBin || ""
});

  } catch (e) {
    console.error("[imei] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
