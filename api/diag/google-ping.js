const { google } = require('googleapis');
const { getJwt } = require('../_lib/sheets'); // or adjust path to your helper

module.exports = async (req, res) => {
  try {
    const auth = getJwt();
    await auth.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.INVENTORY_SHEET_ID });
    res.status(200).json({ ok: true, title: meta.data.properties?.title || null });
  } catch (err) {
    res.status(500).json({
      ok: false,
      name: err.name,
      message: err.message,
      code: err.code,
    });
  }
};
