// Vercel Serverless Function
// Проксирует запросы к OpenRouter (используется и для чата "Laguna", и для "Coder").
// Ключ читается на сервере из переменной окружения OPENROUTER_KEY.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_KEY is not configured on the server' });
  }

  try {
    const { model, messages, max_tokens } = req.body || {};
    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing "model" or "messages" in request body' });
    }

    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        // На сервере нет window.location, поэтому Referer/Title задаём статически.
        'HTTP-Referer': process.env.SITE_URL || 'https://example.vercel.app',
        'X-Title': 'Freebies',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: max_tokens || 800,
      }),
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
