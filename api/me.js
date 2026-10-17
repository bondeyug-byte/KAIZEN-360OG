const { getUser } = require('./_session');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const u = await getUser(req);
  if (!u) return res.status(401).json({ error: 'Sign in required' });
  res.json({ name: u.name, roles: u.roles });
};
