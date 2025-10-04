const { otPostList } = require("./_client");

module.exports = async (req, res) => {
  res.json({ ok: true, msg: "ordertime routes reachable" });
};
