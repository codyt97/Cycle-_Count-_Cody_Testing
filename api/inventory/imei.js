// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

// ---------- utils ----------
const clean = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();
const DIGITS = (s) => String(s ?? "").replace(/\D+/g, "").trim();

function isImeiMatch(a, b) {
  const A = DIGITS(a), B = DIGITS(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // 14 vs 15 digit tolerance
  if (A.length >= 14 && B.length >= 14) return A.endsWith(B) || B.endsWith(A);
  return false;
}

// extract all IMEI-like digit runs (handles multi-IMEI blobs)
function grabAllImeiLike(s) {
  return (String(s ?? "").match(/\d{12,}/g) || []).map(DIGITS);
}

function pickLocation(row = {}) {
  return (
    row.location ||
    row.bin ||
    row.BIN ||
    row.Bin ||
    row.Location ||
    row["Bin Location"] ||
    ""
  );
}

const FIELDS = [
  "systemImei", "imei", "serial",
  "imeis", "imei1", "imei2",
  "note", "notes", "comment", "description"
];

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const imei = clean(req.query.imei);
    const scannedBin = clean(req.query.scannedBin || req.query.bin || req.query.location || "");
    const scannedBy = clean(req.query.scannedBy || req.query.user || "");
    const wantDebug = String(req.query.debug || "").toLowerCase() === "1";

    if (!imei) return bad(res, "imei is required", 400);

    // ---------- A) ALWAYS search FULL INVENTORY snapshot ----------
    const target = DIGITS(imei);
    const target14 = target.length === 15 ? target.slice(-14) : target;

    const inventory = await Store.getInventory(); // array of raw rows
    let invRow = (inventory || []).find(r => {
      for (const f of FIELDS) {
        const v = r[f];
        for (const cand of grabAllImeiLike(v)) {
          if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
        }
        if (isImeiMatch(v, target) || isImeiMatch(v, target14)) return true;
      }
      return false;
    });

    const inventoryLocation = invRow ? pickLocation(invRow) : "";

    // ---------- B) Also search CYCLE-COUNT BINS (secondary) ----------
    const ccBins = await Store.listBins();
    let binsHit = (ccBins || []).find(bin => {
      for (const it of (bin.items || [])) {
        for (const f of FIELDS) {
          const v = it[f];
          for (const cand of grabAllImeiLike(v)) {
            if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
          }
          if (isImeiMatch(v, target) || isImeiMatch(v, target14)) return true;
        }
      }
      return false;
    });
    const binsLocation = binsHit?.bin || "";

    // ---------- C) If caller provided scannedBin, update qtyEntered there (tolerant match) ----------
    let matchedInScannedBin = false;
    if (scannedBin) {
      await Store.upsertBin(scannedBin, (b) => {
        if (!b || !Array.isArray(b.items)) return b;
        const items = b.items.map(it => {
          const v = it?.systemImei;
          if (isImeiMatch(v, target) || isImeiMatch(v, target14)) {
            matchedInScannedBin = true;
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
    }

    // ---------- D) Decide the "location" we return ----------
    // Priority: inventory snapshot (true source of record) > bins listing
    const expectedBin = inventoryLocation || binsLocation || "";
    const location = expectedBin; // normalized for client
    const found = !!expectedBin;

    // ---------- E) Audit wrong-bin attempts (optional) ----------
    let auditLogged = false;
    try {
      if (process.env.LOGS_SHEET_ID && scannedBin) {
        // log even if not found to capture attempts; use "—" if unknown
        await appendRow(process.env.LOGS_SHEET_ID, "WrongBin", [
          nowISO(), imei, scannedBin, expectedBin || "—", scannedBy || "—"
        ]);
        auditLogged = true;
      }
    } catch (e) {
      console.error("[imei] audit append fail:", e?.message || e);
    }

    // ---------- F) Optional debug payload ----------
    let debug;
    if (wantDebug && !found) {
      const suffix = target.slice(-10);
      const close = [];
      for (const r of (inventory || [])) {
        const loc = pickLocation(r);
        let pushed = false;
        for (const f of FIELDS) {
          const raw = String(r[f] ?? "");
          const ds = DIGITS(raw);
          if (ds.includes(suffix)) {
            close.push({
              location: loc,
              field: f,
              sample: raw.length > 120 ? raw.slice(0,117) + "..." : raw
            });
            pushed = true;
            break;
          }
        }
        if (pushed && close.length >= 12) break;
      }
      debug = { nearMatches: close, suffix };
    }

    // ---------- G) Respond ----------
    return ok(res, {
      ok: true,
      imei,
      scannedBin,           // optional; echoes what caller sent
      match: matchedInScannedBin,
      found,
      // Locations by source for transparency:
      inventoryLocation,    // from full inventory snapshot (authoritative)
      binsLocation,         // from cycle-count bins
      expectedBin,          // preferred
      location,             // normalized for client (same as expectedBin)
      auditLogged,
      ...(debug ? { debug } : {})
    });
  } catch (e) {
    console.error("[imei] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
