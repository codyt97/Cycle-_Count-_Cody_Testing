// api/cyclecounts/submit.js
// Persists a bin submission and logs to Google Sheets:
// - Bins (summary)
// - WrongBinAudits
// - NotScanned (now includes BOTH non-serial shortages and serial missing IMEIs,
//   with serial rows enriched using items[] → SKU/Description)

const Store = require("../_lib/store");
const { logBinSummary, logNotScannedMany, logWrongBin } = require("../_lib/logs");

function norm(s){ return String(s ?? "").trim(); }
function userFrom(req, body={}) {
  return String(req.query?.user || body.user || req.headers["x-user"] || "anon").toLowerCase();
}
function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}
async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { res.setHeader("Allow","POST,OPTIONS"); return json(res,405,{ ok:false, error:"method_not_allowed" }); }

  try {
    const body   = await readJSON(req);
    const user   = userFrom(req, body);
    const bin    = norm(body.bin);
    if (!bin) return json(res, 400, { ok:false, error:"missing_bin" });

    const counter = norm(body.counter || "");
    const total   = Number.isFinite(+body.total)   ? +body.total   : 0;
    const scanned = Number.isFinite(+body.scanned) ? +body.scanned : 0;

    // Items & deficits
    const items = Array.isArray(body.items) ? body.items : [];

    // Serial “missing IMEIs” reported by the client
    const missingImeis = Array.isArray(body.missingImeis) ? body.missingImeis : [];

    // Non-serial shortages (derive if not present)
    const nonSerialShortages = Array.isArray(body.nonSerialShortages) ? body.nonSerialShortages :
      items
        .filter(it => !String(it.systemImei || "").trim()) // non-serial rows only
        .map(it => ({
          sku: it.sku || "—",
          description: it.description || "—",
          systemQty: Number(it.systemQty || 0),
          qtyEntered: Number(it.qtyEntered || 0),
        }))
        .filter(s => s.qtyEntered < s.systemQty);

    // Client-buffered wrong-bin list (persist + log)
    const wrongBin = Array.isArray(body.wrongBin) ? body.wrongBin : [];
    if (wrongBin.length) {
      for (const wb of wrongBin) {
        const imei         = norm(wb.imei);
        if (!imei) continue;
        const scannedBin   = norm(wb.scannedBin);
        const trueLocation = norm(wb.trueLocation);

        await Store.appendAudit({
          imei,
          scannedBin,
          trueLocation,
          scannedBy: norm(wb.scannedBy || counter || "—"),
          status: "open",
        });

        try {
          await logWrongBin({
            imei,
            scannedBin,
            trueLocation,
            scannedBy: norm(wb.scannedBy || counter || "—"),
            status: "open",
            moved: false,
          });
        } catch (e) {
          console.warn("[logs] WrongBin append failed:", e?.message || e);
        }
      }
    }

    // Compute missing counts
    const serialMissing = (missingImeis || []).length;
    const nonSerialMissing = (nonSerialShortages || []).reduce(
      (a, s) => a + Math.max(Number(s.systemQty || 0) - Number(s.qtyEntered || 0), 0), 0
    );
    const providedMissing = Number.isFinite(+body.missing) ? +body.missing : null;
    const finalMissing = providedMissing ?? (serialMissing + nonSerialMissing);

    // Persist bin for Investigator/Supervisor views
    const payload = {
      user, bin, counter,
      total, scanned, missing: finalMissing,
      items,
      missingImeis,
      nonSerialShortages,
      state: finalMissing > 0 ? "investigation" : "complete",
      started: body.started || undefined,
      submittedAt: new Date().toISOString(),
    };
    await Store.upsertBin(payload);

    // Google Sheets: Bins summary
    try {
      await logBinSummary({
        bin,
        counter,
        started: body.started || "",
        updated: new Date().toISOString(),
        total, scanned, missing: finalMissing,
        state: payload.state,
      });
    } catch (e) {
      console.warn("[logs] Bins append failed:", e?.message || e);
    }

    // Google Sheets: NotScanned (serial + non-serial)
    try {
      // Map by normalized IMEI for enrichment
      const normImei = s => String(s || "").trim();
      const itemsByImei = new Map();
      for (const it of (items || [])) {
        const key = normImei(it.systemImei);
        if (key) itemsByImei.set(key, it);
      }

      // Serial rows — join to items for SKU/Description when possible
      const seenImeis = new Set();
      const serialRows = [];
      for (const m of (missingImeis || [])) {
        const key = normImei(m.systemImei || m.imei || m.serial);
        if (!key || seenImeis.has(key)) continue;
        seenImeis.add(key);

        const hit = itemsByImei.get(key);
        serialRows.push({
          bin,
          sku: (hit?.sku) || "",
          description: (hit?.description) || "",
          systemQty: 1,
          qtyEntered: 0,
          missing: 1,
          createdAt: new Date().toISOString(),
        });
      }

      // Non-serial rows — prefer from items; fallback to derived array
      const nonSerialFromItems = (items || [])
        .filter(x => !x.systemImei && Number(x.systemQty) > Number(x.qtyEntered || 0))
        .map(x => ({
          bin,
          sku: x.sku || "",
          description: x.description || "",
          systemQty: Number(x.systemQty) || 0,
          qtyEntered: Number(x.qtyEntered) || 0,
          missing: Math.max(0, (Number(x.systemQty) || 0) - (Number(x.qtyEntered) || 0)),
          createdAt: new Date().toISOString(),
        }));

      const nonSerialRows = nonSerialFromItems.length
        ? nonSerialFromItems
        : (nonSerialShortages || []).map(s => ({
            bin,
            sku: s.sku || "",
            description: s.description || "",
            systemQty: Number(s.systemQty) || 0,
            qtyEntered: Number(s.qtyEntered) || 0,
            missing: Math.max(0, (Number(s.systemQty) || 0) - (Number(s.qtyEntered) || 0)),
            createdAt: new Date().toISOString(),
          }));

      const combined = [...serialRows, ...nonSerialRows];
      if (combined.length) {
        await logNotScannedMany(combined);
      }
    } catch (e) {
      console.warn("[logs] NotScanned append failed:", e?.message || e);
    }

    return json(res, 200, {
      ok: true,
      bin,
      state: payload.state,
      submittedAt: payload.submittedAt,
    });

  } catch (err) {
    return json(res, 500, { ok:false, error:"submit_failed", detail: String(err && err.message || err) });
  }
};
