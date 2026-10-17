export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ offline: true });

  const { message, language = "English", context = "" } = req.body;

  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: `You are Campus Assistant. Reply in ${language}. Keep answers short.
Use only this campus data to answer: ${context}`
          }]
        },
        contents: [{ role: "user", parts: [{ text: message }] }],
      }),
    }
  );

  if (!r.ok) return res.status(200).json({ offline: true });
  const data = await r.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  res.status(200).json({ reply, offline: !reply });
}
