// api/diag/logs-test.js
const { google } = require("googleapis");
const { getAuth } = require("../inventory/_drive-cred");

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(body));
}

function requireSheetId() {
  const id = process.env.LOGS_SHEET_ID || "";
  if (!id) throw new Error("Missing LOGS_SHEET_ID");
  return id;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method !== "GET")     return json(res, 405, { ok:false, error:"method_not_allowed" });

  try {
    const auth = getAuth(); // uses GOOGLE_CREDENTIALS_JSON
    const sheets = google.sheets({ version: "v4", auth });
    const drive  = google.drive({ version: "v3", auth });
    const id = requireSheetId();

    // 1) Drive visibility (tests sharing/permissions)
    const file = await drive.files.get({
      fileId: id,
      fields: "id,name,owners(emailAddress),permissions"
    });

    // 2) Sheets metadata (tests Sheets API access + tab presence)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const titles = (meta.data.sheets || []).map(s => s.properties?.title);
    const hasBins       = titles.includes("Bins");
    const hasWrongBin   = titles.includes("WrongBinAudits");
    const hasNotScanned = titles.includes("NotScanned");
    const hasFoundImeis = titles.includes("FoundImeis");

    // 3) Optional write test (?write=1 => appends harmless DIAG row to NotScanned!A:G)
    const doWrite = String(req.query?.write || "").trim() === "1";
    let writeResult = null;
    if (doWrite) {
      const now = new Date().toISOString();
      const resp = await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: "NotScanned!A:G",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [[ "DIAG", "", "logs-test", 0, 0, 0, now ]] }
      });
      writeResult = {
        updatedRange: resp.data.updates?.updatedRange || null,
        updatedRows:  resp.data.updates?.updatedRows  || 0
      };
    }

    return json(res, 200, {
      ok: true,
      spreadsheet: {
        id: file.data.id,
        name: file.data.name,
        hasTabs: { Bins: hasBins, WrongBinAudits: hasWrongBin, NotScanned: hasNotScanned, FoundImeis: hasFoundImeis },
        titles
      },
      writeAttempted: doWrite,
      writeResult
    });
  } catch (e) {
    return json(res, 500, { ok:false, error: String(e?.message || e) });
  }
};
