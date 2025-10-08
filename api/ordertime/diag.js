// api/ordertime/diag.js
const { buildPayload, postList } = require('./_client');

module.exports = async (req, res) => {
  const info = {
    base: (process.env.OT_BASE_URL || '').replace(/.(?=.{6}$)/g, '*'),
    mode: (process.env.OT_AUTH_MODE || '').trim(),
    companySet: !!(process.env.OT_COMPANY || '').trim(),
    usernameSet: !!(process.env.OT_USERNAME || '').trim(),
    passwordSet: !!(process.env.OT_PASSWORD || '').trim(),
    apiKeyLen: (process.env.OT_API_KEY || '').trim().length || 0,
  };

  const out = {};
  try {
    const payload = buildPayload({ type: 1141, filters: [], page: 1, pageSize: 1 });
    out.payloadKeys = Object.keys(payload); // shows which auth keys are present
    const data = await postList(payload);
    out.ok = true;
    out.rows = Array.isArray(data?.Rows) ? data.Rows.length : 0;
  } catch (e) {
    out.ok = false;
    out.err = String(e.message || e);
  }

  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ info, out }));
};
