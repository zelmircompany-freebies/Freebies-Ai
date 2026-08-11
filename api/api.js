// Vercel Serverless Function — единая точка входа для всех бэкенд-прокси проекта.
// Объединяет: agnes-image, agnes-video, agnes-video-status, gemini,
// openrouter, openrouter-ru, pollinations-image.
//
// Роутинг по параметру action:
//   ?action=agnes-image        (POST)  — генерация изображения через Agnes AI
//   ?action=agnes-video        (POST)  — запуск генерации видео через Agnes AI
//   ?action=agnes-video-status (GET)   — статус генерации видео (+ ?video_id=...)
//   ?action=gemini             (POST)  — прокси к Google Gemini
//   ?action=openrouter         (POST)  — прокси к OpenRouter (Laguna / Coder)
//   ?action=openrouter-ru      (POST)  — прокси к OpenRouter для RU (отдельный ключ)
//   ?action=pollinations-image (POST)  — генерация изображения через Pollinations
//
// Все ключи по-прежнему читаются на сервере из переменных окружения и никогда
// не попадают в браузер.

async function callWithRetry(endpoint, payload, keyPool, maxAttempts = 6) {
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

function getAgnesKeyPool() {
  const AGNES_KEY = process.env.AGNES_KEY;
  const AGNES_BACKUP_KEYS = (process.env.AGNES_BACKUP_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  return AGNES_KEY ? [AGNES_KEY, ...AGNES_BACKUP_KEYS] : [];
}

/* ============ agnes-image ============ */
async function handleAgnesImage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AGNES_IMAGE_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
  const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';
  const keyPool = getAgnesKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });

  try {
    const { prompt, startImageBase64, size } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in request body' });

    const payload = {
      model: AGNES_IMAGE_MODEL,
      prompt,
      size: size || '1024x1024',
    };
    if (startImageBase64) {
      payload.extra_body = { image: [startImageBase64], response_format: 'url' };
    }

    const data = await callWithRetry(AGNES_IMAGE_URL, payload, keyPool);

    const item = data?.data?.[0];
    if (item && item.url) return res.status(200).json({ url: item.url });
    if (item && item.b64_json) return res.status(200).json({ url: `data:image/png;base64,${item.b64_json}` });

    return res.status(502).json({ error: 'Agnes did not return a result' });
  } catch (err) {
    // Клиент при ошибке сам переключится на бесплатный Pollinations (см. script.js).
    return res.status(502).json({ error: err.message || 'Agnes request failed' });
  }
}

/* ============ agnes-video ============ */
async function handleAgnesVideo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AGNES_VIDEO_URL = 'https://apihub.agnes-ai.com/v1/videos';
  const AGNES_VIDEO_MODEL = 'agnes-video-v2.0';
  const keyPool = getAgnesKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });

  try {
    const { prompt, startImageBase64, duration, dims } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in request body' });

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

    const data = await callWithRetry(AGNES_VIDEO_URL, payload, keyPool, 6);

    const directUrl = data.url || data.video_url || data.result?.url;
    if (directUrl) return res.status(200).json({ url: directUrl });

    const videoId = data.video_id || data.id;
    if (!videoId) return res.status(502).json({ error: 'Agnes AI did not return URL or video_id.' });

    return res.status(200).json({ video_id: videoId });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Agnes video request failed' });
  }
}

/* ============ agnes-video-status ============ */
async function handleAgnesVideoStatus(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const AGNES_VIDEO_POLL_URL = 'https://apihub.agnes-ai.com/agnesapi';
  const keyPool = getAgnesKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });

  const { video_id } = req.query;
  if (!video_id) return res.status(400).json({ error: 'Missing "video_id" query parameter' });

  for (const key of keyPool) {
    try {
      const upstream = await fetch(`${AGNES_VIDEO_POLL_URL}?video_id=${encodeURIComponent(video_id)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (upstream.status === 429 || upstream.status === 420) continue;
      if (upstream.ok) {
        const data = await upstream.json();
        return res.status(200).json(data);
      }
    } catch (_) {
      // try next key
    }
  }

  return res.status(502).json({ error: 'All keys failed for status check' });
}

/* ============ gemini ============ */
async function handleGemini(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_KEY;
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_KEY is not configured on the server' });

  try {
    const { parts } = req.body || {};
    if (!parts) return res.status(400).json({ error: 'Missing "parts" in request body' });

    const payload = { contents: [{ parts }] };

    const upstream = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}

/* ============ openrouter (Laguna / Coder — основной ключ) ============ */
async function handleOpenrouter(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

  if (!OPENROUTER_KEY) return res.status(500).json({ error: 'OPENROUTER_KEY is not configured on the server' });

  try {
    const { model, messages, max_tokens } = req.body || {};
    if (!model || !messages) return res.status(400).json({ error: 'Missing "model" or "messages" in request body' });

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
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}

/* ============ openrouter-ru (отдельный ключ OPENROUTER_BASE_KEY) ============ */
async function handleOpenrouterRu(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_BASE_KEY = process.env.OPENROUTER_BASE_KEY;
  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free';

  if (!OPENROUTER_BASE_KEY) return res.status(500).json({ error: 'OPENROUTER_BASE_KEY is not configured on the server' });

  try {
    const { model, messages, max_tokens } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing "messages" in request body' });

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
    if (!upstream.ok) return res.status(upstream.status).json({ error: data });

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}

/* ============ pollinations-image ============ */
async function handlePollinationsImage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const POLLINATIONS_TOKEN = process.env.POLLINATIONS_TOKEN;

  try {
    const { prompt, width, height } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in request body' });

    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000000);
    const w = width || 1024;
    const h = height || 1024;
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${w}&height=${h}&seed=${seed}&nologo=true`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const headers = {};
    if (POLLINATIONS_TOKEN) headers['Authorization'] = `Bearer ${POLLINATIONS_TOKEN}`;

    let upstream;
    try {
      upstream = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!upstream.ok) return res.status(upstream.status).json({ error: `Pollinations error (${upstream.status})` });

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';

    return res.status(200).json({ url: `data:${contentType};base64,${base64}` });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Pollinations request failed' });
  }
}

/* ============ Роутер ============ */
const ROUTES = {
  'agnes-image': handleAgnesImage,
  'agnes-video': handleAgnesVideo,
  'agnes-video-status': handleAgnesVideoStatus,
  'gemini': handleGemini,
  'openrouter': handleOpenrouter,
  'openrouter-ru': handleOpenrouterRu,
  'pollinations-image': handlePollinationsImage,
};

export default async function handler(req, res) {
  const action = req.query?.action;
  const route = ROUTES[action];

  if (!route) {
    return res.status(400).json({
      error: `Unknown or missing "action". Use one of: ${Object.keys(ROUTES).join(', ')}`,
    });
  }

  return route(req, res);
}
