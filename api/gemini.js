// Vercel Serverless Function
// Проксирует запросы к Google Gemini API. Ключ никогда не попадает в браузер —
// он читается на сервере из переменной окружения GEMINI_KEY (Vercel → Settings → Environment Variables).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: 'GEMINI_KEY is not configured on the server' });
  }

  try {
    const { parts } = req.body || {};
    if (!parts) {
      return res.status(400).json({ error: 'Missing "parts" in request body' });
    }

    const payload = { contents: [{ parts }] };

    const upstream = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}
