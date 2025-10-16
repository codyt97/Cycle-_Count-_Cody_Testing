// api/inventory/_drive-cred.js
const { google } = require("googleapis");

function getAuth() {
  const json = process.env.GOOGLE_CREDENTIALS_JSON || "";
  const SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",   // FULL Sheets access (read/write)
    "https://www.googleapis.com/auth/drive.readonly"  // read-only Drive
  ];

  if (json) {
    const creds = JSON.parse(json);
    const pk = (creds.private_key || "").replace(/\r\n/g, "\n");
    return new google.auth.JWT(creds.client_email, null, pk, SCOPES);
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing Google credentials");
  return new google.auth.JWT(email, null, key, SCOPES);
}

function driveClient() {
  const auth = getAuth();
  return google.drive({ version: "v3", auth });
}

module.exports = { getAuth, driveClient };
