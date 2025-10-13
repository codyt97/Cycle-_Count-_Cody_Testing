const fetch = global.fetch || require("node-fetch");

module.exports = async (req, res) => {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ ok: false, err: "Method not allowed" });
    return;
  }
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const steps = [];

    // 1. Drive test
    let r = await fetch(`${base}/api/inventory/drive-test`);
    steps.push({ step: "drive-test", ok: r.ok });
    if (!r.ok) throw new Error("drive-test failed");

    // 2. Drive sync
    r = await fetch(`${base}/api/inventory/drive-sync`);
    steps.push({ step: "drive-sync", ok: r.ok });
    if (!r.ok) throw new Error("drive-sync failed");

    // 3. Status
    r = await fetch(`${base}/api/inventory/status`);
    const j = await r.json();
    steps.push({ step: "status", count: j?.records?.length || j?.count || 0 });
    res.json({ ok: true, steps });
  } catch (e) {
    res.status(500).json({ ok: false, err: e.message });
  }
};