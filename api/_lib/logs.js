// api/_lib/logs.js
const { google } = require("googleapis");
const { getAuth } = require("../inventory/_drive-cred");

function sheets() { return google.sheets({ version: "v4", auth: getAuth() }); }
function ssid() {
  const id = process.env.LOGS_SHEET_ID || "";
  if (!id) throw new Error("Missing LOGS_SHEET_ID");
  return id;
}

async function append(range, row) {
  await sheets().spreadsheets.values.append({
    spreadsheetId: ssid(),
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] }
  });
}

async function appendMany(range, rows) {
  if (!rows.length) return;
  await sheets().spreadsheets.values.append({
    spreadsheetId: ssid(),
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows }
  });
}

// ---- domain-specific helpers ----
async function logWrongBin(a) {
  return append("WrongBinAudits!A:I", [
    a.imei || "",
    a.scannedBin || "",
    a.trueLocation || "",
    a.scannedBy || a.user || "",
    a.status || "open",
    a.moved ? "Yes" : "No",
    a.movedTo || "",
    a.movedBy || "",
    a.createdAt || new Date().toISOString()
  ]);
}

async function logBinSummary(b) {
  return append("Bins!A:I", [
    b.bin || "",
    b.counter || "",
    b.started || "",
    b.updated || "",
    Number.isFinite(b.total) ? b.total : "",
    Number.isFinite(b.scanned) ? b.scanned : "",
    Number.isFinite(b.missing) ? b.missing : "",
    b.state || "",
    b.createdAt || new Date().toISOString()
  ]);
}

async function logNotScannedMany(rows) {
  // rows: { bin, sku, description, systemQty, qtyEntered, missing, createdAt }
  return appendMany("NotScanned!A:G", rows.map(r => ([
    r.bin || "",
    r.sku || "",
    r.description || "",
    Number.isFinite(r.systemQty) ? r.systemQty : "",
    Number.isFinite(r.qtyEntered) ? r.qtyEntered : "",
    Number.isFinite(r.missing) ? r.missing : "",
    r.createdAt || new Date().toISOString()
  ])));
}

async function logFoundImei(x) {
  return append("FoundImeis!A:E", [
    x.imei || "",
    x.foundInBin || "",
    x.scannedBin || "",
    x.foundBy || x.user || "",
    x.createdAt || new Date().toISOString()
  ]);
}

module.exports = {
  logWrongBin,
  logBinSummary,
  logNotScannedMany,
  logFoundImei
};
