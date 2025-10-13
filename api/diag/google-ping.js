// api/diag/google-ping.js
const { google } = require("googleapis");

/** robust loader: supports GOOGLE_CREDENTIALS_B64, GOOGLE_PRIVATE_KEY_B64, or GOOGLE_PRIVATE_KEY */
function loadGoogleCreds() {
  // Best: whole JSON key as base64
  if (process.env.GOOGLE_CREDENTIALS_B64) {
    const json = Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64").toString("utf8").trim();
    const creds = JSON.parse(json);
    return {
      client_email: creds.client_email,
      private_key: (creds.private_key || "").replace(/\r\n/g, "\n"),
    };
  }

  // Next best: just the PEM as base64
  if (process.env.GOOGLE_PRIVATE_KEY_B64 && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    const pem = Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, "base64").toString("utf8").trim();
    return {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim(),
      private_key: pem.replace(/\r\n/g, "\n"),
    };
  }

  // Fallback: raw env (single line or multiline)
  let raw = process.env.GOOGLE_PRIVATE_KEY || "";
  let private_key = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
  private_key = private_key.trim().replace(/^"|"$/g, "").replace(/\r\n/g, "\n");

  return {
    client_email: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim(),
    private_key,
  };
}

module.exports = async (req, res) => {
  try {
    const { client_email, private_key } = loadGoogleCreds();
    if (!client_email || !private_key) throw new Error("Missing Google service account creds");

    const auth = new google.auth.JWT(client_email, null, private_key, [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
    await auth.authorize();

    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.INVENTORY_SHEET_ID,
    });

    res.status(200).json({ ok: true, title: meta.data.properties?.title || null });
  } catch (err) {
    res.status(500).json({ ok: false, name: err.name, message: err.message, code: err.code });
  }
};
