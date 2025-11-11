// api/audit/wrong-bin.js
// Server-side logging for WrongBinAudits with secure enrichment of SKU/Description
// - Accepts POST JSON: { imei, scannedBin, trueLocation, scannedBy }
// - Looks up SKU/Description from Inventory (server-side), then appends full row A–K into the WrongBinAudits tab
// - Returns { ok: true, appendedRow } on success
//
// Env vars required:
//   GOOGLE_CREDENTIALS_JSON   -> entire service account JSON (stringified)
//   LOGS_SHEET_ID             -> Spreadsheet ID for "ConnectUs – Cycle Count Logs"
//   INVENTORY_SHEET_ID        -> Spreadsheet ID for the Inventory source of truth
// Optional env vars:
//   WRONGBIN_TAB              -> defaults to "WrongBinAudits"
//   INVENTORY_TAB             -> defaults to "Inventory"
//
// Notes:
// - Keep this route server-side only (no client secret exposure).
// - Frontend should *not* send sku/description; we derive them here from Inventory.
// - IMEI normalization for lookup: digits-only (strip non-digits). Sheet stores raw IMEI as provided for readability.

import { google } from "googleapis"

// ---------- ENV ----------
const {
  GOOGLE_CREDENTIALS_JSON,
  LOGS_SHEET_ID,
  INVENTORY_SHEET_ID,
  WRONGBIN_TAB = "WrongBinAudits",
  INVENTORY_TAB = "Inventory",
} = process.env

// ---------- AUTH / SHEETS CLIENT ----------
function getSheetsClient(scopes = ["https://www.googleapis.com/auth/spreadsheets"]) {
  if (!GOOGLE_CREDENTIALS_JSON) {
    throw new Error("Missing GOOGLE_CREDENTIALS_JSON")
  }
  const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON)
  const jwt = new google.auth.JWT(
    creds.client_email,
    null,
    (creds.private_key || "").replace(/\\n/g, "\n"),
    scopes
  )
  return google.sheets({ version: "v4", auth: jwt })
}

// ---------- HELPERS ----------
const normIMEIKey = (v) => (v == null ? "" : String(v).replace(/\D+/g, "").trim())
const safeStr = (v) => (v == null ? "" : String(v).trim())

async function loadInventorySnapshot() {
  if (!INVENTORY_SHEET_ID) {
    throw new Error("Missing INVENTORY_SHEET_ID")
  }
  const sheets = getSheetsClient()
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: INVENTORY_SHEET_ID,
    range: `${INVENTORY_TAB}!A:Z`,
  })
  const rows = resp.data.values || []
  if (!rows.length) return []

  const header = rows[0].map((h) => (h || "").toString().trim())
  const colIdx = (nameRegexArr) => {
    const idx = header.findIndex((h) => nameRegexArr.some((re) => re.test(h)))
    return idx < 0 ? null : idx
  }

  const idxIMEI = colIdx([/^(imei)$/i])
  const idxSKU = colIdx([/^sku$/i, /^stock\s*keeping\s*unit$/i])
  const idxDESC = colIdx([/^desc(ription)?$/i, /^item\s*desc(ription)?$/i])

  // If headers unknown, fallback to positional guess (NOT recommended but prevents hard failure)
  const safeIdxIMEI = idxIMEI ?? 0
  const safeIdxSKU = idxSKU ?? 1
  const safeIdxDESC = idxDESC ?? 2

  const data = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || []
    data.push({
      imei: r[safeIdxIMEI] ?? "",
      sku: r[safeIdxSKU] ?? "",
      description: r[safeIdxDESC] ?? "",
    })
  }
  return data
}

async function buildImeiIndex() {
  const inv = await loadInventorySnapshot()
  const idx = Object.create(null)
  for (const rec of inv) {
    const key = normIMEIKey(rec.imei)
    if (!key) continue
    // Last write wins; acceptable for this use case
    idx[key] = {
      sku: safeStr(rec.sku),
      description: safeStr(rec.description),
    }
  }
  return idx
}

async function appendWrongBinRow(row) {
  if (!LOGS_SHEET_ID) {
    throw new Error("Missing LOGS_SHEET_ID")
  }
  const sheets = getSheetsClient()
  return sheets.spreadsheets.values.append({
    spreadsheetId: LOGS_SHEET_ID,
    range: `${WRONGBIN_TAB}!A:K`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  })
}

// ---------- REQUEST HANDLER ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ ok: false, error: "Method Not Allowed" })
  }

  try {
    const { imei, scannedBin, trueLocation, scannedBy } = req.body || {}

    // Basic validation
    const imeiKey = normIMEIKey(imei)
    if (!imeiKey) {
      return res.status(400).json({ ok: false, error: "IMEI is required" })
    }
    if (!safeStr(scannedBin) || !safeStr(trueLocation)) {
      return res.status(400).json({ ok: false, error: "scannedBin and trueLocation are required" })
    }

    // Build index & enrich from inventory (server-side only)
    const imeiIndex = await buildImeiIndex()
    const inv = imeiIndex[imeiKey] || {}
    const sku = safeStr(inv.sku)
    const description = safeStr(inv.description)

    // Prepare A–K row for WrongBinAudits
    // Columns:
    // A: IMEI (raw as provided for readability)
    // B: Sku (from inventory)
    // C: Description (from inventory)
    // D: ScannedBin
    // E: TrueLocation
    // F: ScannedBy
    // G: Status ("open" at creation)
    // H: Moved? ("No" at creation)
    // I: MovedTo (empty)
    // J: MovedBy (empty)
    // K: CreatedAt (ISO8601)
    const appendedRow = [
      safeStr(imei),
      sku,
      description,
      safeStr(scannedBin),
      safeStr(trueLocation),
      safeStr(scannedBy),
      "open",
      "No",
      "",
      "",
      new Date().toISOString(),
    ]

    await appendWrongBinRow(appendedRow)

    return res.status(200).json({ ok: true, appendedRow })
  } catch (err) {
    console.error("[wrong-bin] error:", err)
    const message = err?.message || "Internal Server Error"
    return res.status(500).json({ ok: false, error: message })
  }
}
