// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

// ---------- utils ----------
const clean = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();
const DIGITS = (s) => String(s ?? "").replace(/\D+/g, "").trim();

// tolerant IMEI equality (handles 14 vs 15 digit, minor formatting)
function isImeiMatch(a, b) {
  const A = DIGITS(a), B = DIGITS(b);
  if (!A || !B) return false;
  if (A === B) return true;
  // treat 14/15 as match if one ends with the other
  if (A.length >= 14 && B.length >= 14) return A.endsWith(B) || B.endsWith(A);
  return false;
}

// extract all IMEI-like runs from any blob (splits multi-IMEI cells)
function grabAllImeiLike(s) {
  return (String(s ?? "").match(/\d{12,}/g) || []).map(DIGITS);
}

// best-effort mapping for a location field on raw inventory rows
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
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const imei = clean(req.query.imei);
    const scannedBin = clean(req.query.scannedBin || req.query.bin);
    const scannedBy = clean(req.query.scannedBy || req.query.user || "");
    const wantDebug = String(req.query.debug || "").toLowerCase() === "1";

    if (!imei || !scannedBin) {
      return bad(res, "imei and scannedBin are required", 400);
    }

    let matched = false;

    // --- 1) Try to match inside the CURRENT (scanned) bin; if match -> set qtyEntered=1
    await Store.upsertBin(scannedBin, (b) => {
      if (!b || !Array.isArray(b.items)) return b;

      const items = b.items.map((it) => {
        const cand = it?.systemImei;
        if (isImeiMatch(cand, imei)) {
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

    // --- 2) If not matched, find TRUE location: search cycle-count bins, then full inventory
    let expectedBin = matched ? scannedBin : "";
    let auditLogged = false;
    let debugInfo;

    if (!matched) {
      const target = DIGITS(imei);
      const target14 = target.length === 15 ? target.slice(-14) : target;

      // 2a) search all cycle-count bins first (fast path)
      const ccBins = await Store.listBins();
      let hitBin = (ccBins || []).find((bin) => {
        for (const it of (bin.items || [])) {
          // common fields IMEI may live in
          const fields = [
            it.systemImei, it.imei, it.serial,
            it.imeis, it.imei1, it.imei2,
            it.note, it.notes, it.comment, it.description
          ];

          for (const f of fields) {
            // multi-IMEI cells
            const many = grabAllImeiLike(f);
            for (const cand of many) {
              if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
            }
            // single value check (after normalization)
            if (isImeiMatch(f, target) || isImeiMatch(f, target14)) return true;
          }
        }
        return false;
      });

      // 2b) fallback: search the FULL inventory snapshot (covers items not assigned to a CC bin)
      if (!hitBin) {
        const inv = await Store.getInventory(); // array of rows with location + fields
        const hitRow = (inv || []).find((r) => {
          const fields = [
            r.systemImei, r.imei, r.serial,
            r.imeis, r.imei1, r.imei2,
            r.notes, r.comment, r.description
          ];
          for (const f of fields) {
            const many = grabAllImeiLike(f);
            for (const cand of many) {
              if (isImeiMatch(cand, target) || isImeiMatch(cand, target14)) return true;
            }
            if (isImeiMatch(f, target) || isImeiMatch(f, target14)) return true;
          }
          return false;
        });

        if (hitRow) {
          expectedBin = pickLocation(hitRow);
        } else if (wantDebug) {
          // Build near-match hints (last 8–10 digits) to help diagnose sheet content issues
          const inv = await Store.getInventory();
          const suffix = target.slice(-10);
          const close = [];
          for (const r of (inv || [])) {
            const fields = [
              r.systemImei, r.imei, r.serial,
              r.imeis, r.imei1, r.imei2,
              r.notes, r.comment, r.description
            ];
            let pushed = false;
            for (const f of fields) {
              const raw = String(f ?? "");
              if (/\d{10,}/.test(raw) && DIGITS(raw).includes(suffix)) {
                close.push({
                  location: pickLocation(r),
                  field: fields.indexOf(f), // simple index; avoids leaking keys variably
                  sample: raw.length > 120 ? (raw.slice(0,117) + "...") : raw
                });
                pushed = true;
                break;
              }
            }
            if (pushed && close.length >= 12) break;
          }
          debugInfo = { nearMatches: close, lookedAt: close.length, suffix };
        }
      } else {
        expectedBin = hitBin.bin || "";
      }

      // 2c) Audit wrong-bin attempt (even if not found we log the attempt with "—")
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

    // --- response (normalized: include both expectedBin + location for the client)
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
