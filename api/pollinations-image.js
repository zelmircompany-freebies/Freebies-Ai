// Vercel Serverless Function
// Проксирует генерацию изображений через Pollinations (image.pollinations.ai).
// Токен читается на сервере из переменной окружения POLLINATIONS_TOKEN
// (получить бесплатно на https://auth.pollinations.ai — даёт лимит 1 запрос/5с
// вместо 1 запрос/15с для анонимных запросов).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const POLLINATIONS_TOKEN = process.env.POLLINATIONS_TOKEN;

  try {
    const { prompt, width, height } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Missing "prompt" in request body' });
    }

    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const w = width || 1024;
    const h = height || 1024;
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const headers = {};
    if (POLLINATIONS_TOKEN) {
      headers['Authorization'] = `Bearer ${POLLINATIONS_TOKEN}`;
    }

    let upstream;
    try {
      upstream = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Pollinations error (${upstream.status})` });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    return res.status(200).json({ url: `data:${contentType};base64,${base64}` });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Pollinations request failed' });
  }
}
