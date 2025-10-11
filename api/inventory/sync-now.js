// api/inventory/sync-now.js
const driveSync = require("./drive-sync");
module.exports = async (req, res) => {
  // Allow GET to make it easy to run from the browser
  req.method = "POST";
  // Allow token via query string ?token=...
  if (!req.headers["x-sync-token"] && req.query && req.query.token) {
    req.headers["x-sync-token"] = String(req.query.token);
  }
  return driveSync(req, res);
};
