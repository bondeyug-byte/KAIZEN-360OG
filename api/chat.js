module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!require('./_session').getPhone(req)) return res.status(401).json({ offline: true, reason: 'sign in required' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.json({ offline: true, reason: 'no key' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { message = '', language = 'English', context = '' } = body;

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You are Campus Assistant. Reply in ' + language +
                '. Keep answers short. Use only this campus data to answer: ' + context
            }]
          },
          contents: [{ role: 'user', parts: [{ text: message }] }]
        })
      }
    );

    if (!r.ok) return res.json({ offline: true, reason: 'gemini ' + r.status });

    const data = await r.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.json({ reply: reply || '', offline: !reply });
  } catch (e) {
    return res.json({ offline: true, reason: 'error' });
  }
};
