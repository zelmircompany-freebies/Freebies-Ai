// Vercel Serverless Function
// Запускает генерацию видео через Agnes AI. Возвращает либо готовый url,
// либо video_id, который клиент затем поллит через /api/agnes-video-status.

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
  const AGNES_VIDEO_URL = 'https://apihub.agnes-ai.com/v1/videos';
  const AGNES_VIDEO_MODEL = 'agnes-video-v2.0';

  if (!AGNES_KEY) {
    return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });
  }

  try {
    const { prompt, startImageBase64, duration, dims } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'Missing "prompt" in request body' });
    }

    const frameRate = 24;
    const dur = duration || 5;
    const numFrames = Math.round(dur * frameRate) + 1;
    const [width, height] = (dims || '1152x768').split('x').map(Number);

    const payload = {
      model: AGNES_VIDEO_MODEL,
      prompt,
      height,
      width,
      num_frames: numFrames,
      frame_rate: frameRate,
    };
    if (startImageBase64) {
      payload.image = startImageBase64;
    }

    const keyPool = [AGNES_KEY, ...AGNES_BACKUP_KEYS];
    const data = await callAgnesWithRetry(AGNES_VIDEO_URL, payload, keyPool, 6);

    const directUrl = data.url || data.video_url || data.result?.url;
    if (directUrl) return res.status(200).json({ url: directUrl });

    const videoId = data.video_id || data.id;
    if (!videoId) return res.status(502).json({ error: 'Agnes AI did not return URL or video_id.' });

    return res.status(200).json({ video_id: videoId });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Agnes video request failed' });
  }
}
