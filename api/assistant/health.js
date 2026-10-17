module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  res.json({ available: !!key, providers: key ? ['Gemini'] : [] });
};
