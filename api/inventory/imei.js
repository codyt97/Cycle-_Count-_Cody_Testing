// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

// --------------- utils ---------------
const clean = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();
const DIGITS = (s) => String(s ?? "").replace(/\D+/g, "").trim();

// tolerant IMEI equality (14 vs 15 digit, formatting)
function isImeiMatch(a, b) {
  const A = DIGITS(a), B = DIGITS(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // treat 14/15 as match if one ends with the other
  if (A.length >= 14 && B.length >= 14) return A.endsWith(B) || B.endsWith(A);
  return false;
}

// extract all IMEI-like sequences from any blob (handles multi-IMEI cells)
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

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);
  withCORS(res);

  try {
    const imei = clean(req.query.imei);
    const scannedBin = clean(req.query.scannedBin || req.query.bin || req.query.location || "");
    const scannedBy = clean(req.query.scannedBy || req.query.user || "");
    const wantDebug = String(req.query.debug || "").toLowerCase() === "1";

    if (!imei) return bad(res, "imei is required", 400);
    if (!scannedBin) return bad(res, "scannedBin (bin) is required", 400);

    let matched = false;

    // 1) Try to match inside the CURRENT (scanned) bin; if match -> qtyEntered=1
    await Store.upsertBin(scannedBin, (b) => {
      if (!b || !Array.isArray(b.items)) return b;

      const items = b.items.map((it) => {
        if (isImeiMatch(it?.systemImei, imei)) {
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

    // 2) If not matched, find TRUE location: CC bins -> full inventory
    let expectedBin = matched ? scannedBin : "";
    let auditLogged = false;
    let debugInfo;

    if (!matched) {
      const target = DIGITS(imei);
      const target14 = target.length === 15 ? target.slice(-14) : target;
      const FIELDS = [
        "systemImei", "imei", "serial",
        "imeis", "imei1", "imei2",
        "note", "notes", "comment", "description"
      ];

      // 2a) search all cycle-count bins first
      const ccBins = await Store.listBins();
      let hitBin = (ccBins || []).find((bin) => {
        for (const it of (bin.items || [])) {
          for (const f of FIELDS) {
            const v = it[f];
            // multi-IMEI blobs
            for (const cand of grabAllImeiLike(v)) {
              if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
            }
            // single value
            if (isImeiMatch(v, target) || isImeiMatch(v, target14)) return true;
          }
        }
        return false;
      });

      // 2b) fallback: search full inventory snapshot (items not in CC bins)
      if (!hitBin) {
        const inv = await Store.getInventory();
        const row = (inv || []).find((r) => {
          for (const f of FIELDS) {
            const v = r[f];
            for (const cand of grabAllImeiLike(v)) {
              if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
            }
            if (isImeiMatch(v, target) || isImeiMatch(v, target14)) return true;
          }
          return false;
        });

        if (row) {
          expectedBin = pickLocation(row);
        } else if (wantDebug) {
          // near-match hints (last 10 digits) to diagnose data issues
          const suffix = target.slice(-10);
          const close = [];
          for (const r of (inv || [])) {
            const loc = pickLocation(r);
            let pushed = false;
            for (const f of FIELDS) {
              const raw = String(r[f] ?? "");
              const ds = DIGITS(raw);
              if (ds.includes(suffix)) {
                close.push({
                  location: loc,
                  field: f,
                  sample: raw.length > 120 ? raw.slice(0, 117) + "..." : raw
                });
                pushed = true;
                break;
              }
            }
            if (pushed && close.length >= 12) break;
          }
          debugInfo = { nearMatches: close, suffix };
        }
      } else {
        expectedBin = hitBin.bin || "";
      }

      // 2c) audit wrong-bin attempt (even if we didn’t find a location yet)
      try {
        if (process.env.LOGS_SHEET_ID) {
          await appendRow(process.env.LOGS_SHEET_ID, "WrongBin", [
            nowISO(), imei, scannedBin, expectedBin || "—", scannedBy || "—"
          ]);
          auditLogged = true;
        }
      } catch (e) {
        console.error("[imei] audit append fail:", e?.message || e);
      }
    }

    // 3) Response: include both expectedBin + location (normalized)
    const found = !!expectedBin;
    return ok(res, {
      ok: true,
      match: matched,
      imei,
      scannedBin,
      expectedBin,
      location: expectedBin || "",
      found,
      auditLogged,
      ...(debugInfo ? { debug: debugInfo } : {})
    });
  } catch (e) {
    console.error("[imei] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
