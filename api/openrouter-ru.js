// Vercel Serverless Function
// Отдельный прокси к OpenRouter специально для российских пользователей.
// Использует ОТДЕЛЬНЫЙ ключ OPENROUTER_BASE_KEY (не путать с OPENROUTER_KEY,
// который остаётся основным для Laguna / остального мира).
// Модель по умолчанию: google/gemma-4-26b-a4b-it:free

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const OPENROUTER_BASE_KEY = process.env.OPENROUTER_BASE_KEY;
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

  if (!OPENROUTER_BASE_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_BASE_KEY is not configured on the server' });
  }

  try {
    const { model, messages, max_tokens } = req.body || {};
    if (!messages) {
      return res.status(400).json({ error: 'Missing "messages" in request body' });
    }

    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_BASE_KEY}`,
        'HTTP-Referer': process.env.SITE_URL || 'https://freebies-ai.site',
        'X-Title': 'Freebies RU',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
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
