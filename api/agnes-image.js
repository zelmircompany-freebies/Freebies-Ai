// Vercel Serverless Function
// Проксирует генерацию изображений через Agnes AI.
// Пул ключей (основной + резервные) хранится на сервере в переменных окружения
// AGNES_KEY и AGNES_BACKUP_KEYS (последняя — через запятую).

async function callAgnesWithRetry(endpoint, payload, keyPool, maxAttempts = 6) {
  let lastError = null;
  const usedKeys = new Set();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = keyPool[attempt % keyPool.length];
    if (usedKeys.has(key) && keyPool.length > 1) continue;
    usedKeys.add(key);

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(payload),
      });

      if (upstream.status === 429 || upstream.status === 420 || upstream.status === 500) {
        lastError = new Error(`API error (${upstream.status})`);
        continue;
      }
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        lastError = new Error(`Agnes error (${upstream.status}): ${errText.slice(0, 300)}`);
        continue;
      }
      return await upstream.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('All API keys exhausted.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const AGNES_KEY = process.env.AGNES_KEY;
  const AGNES_BACKUP_KEYS = (process.env.AGNES_BACKUP_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  const AGNES_IMAGE_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
  const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';

  if (!AGNES_KEY) {
    return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });
  }

  try {
    const { prompt, startImageBase64, size } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Missing "prompt" in request body' });
    }

    const payload = {
      model: AGNES_IMAGE_MODEL,
      prompt,
      size: size || '1024x1024',
    };
    if (startImageBase64) {
      payload.extra_body = { image: [startImageBase64], response_format: 'url' };
    }

    const keyPool = [AGNES_KEY, ...AGNES_BACKUP_KEYS];
    const data = await callAgnesWithRetry(AGNES_IMAGE_URL, payload, keyPool);

    const item = data?.data?.[0];
    if (item && item.url) return res.status(200).json({ url: item.url });
    if (item && item.b64_json) return res.status(200).json({ url: `data:image/png;base64,${item.b64_json}` });

    return res.status(502).json({ error: 'Agnes did not return a result' });
  } catch (err) {
    // Клиент при ошибке сам переключится на бесплатный Pollinations (это остаётся в script.js).
    return res.status(502).json({ error: err.message || 'Agnes request failed' });
  }
}
