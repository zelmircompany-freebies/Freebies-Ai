// Vercel Serverless Function — единая точка входа для всех бэкенд-прокси проекта.
// Объединяет: agnes-image, agnes-video, agnes-video-status, upload-media, gemini,
// openrouter, openrouter-ping, pollinations-image.
//
// Роутинг по параметру action:
//   ?action=agnes-image        (POST)  — генерация изображения (agnes-image-2.5/2.1/2.0-flash)
//   ?action=agnes-video        (POST)  — запуск генерации видео (agnes-video-2.5-flash)
//   ?action=agnes-video-status (GET)   — статус генерации видео (+ ?video_id=...)
//   ?action=upload-media       (POST)  — загружает base64-картинку/аудио в Supabase Storage
//                                        и возвращает публичный URL (нужен для i2i, keyframes,
//                                        reference images и custom audio на Agnes — все эти
//                                        режимы принимают только публичные URL, не base64)
//   ?action=gemini             (POST)  — прокси к Google Gemini
//   ?action=openrouter         (POST)  — прокси к OpenRouter, единый route для ВСЕХ текстовых
//                                        моделей чата. Ключи: OPENROUTER_KEY, OPENROUTER_BACKUP_KEYS
//                                        (через запятую), OPENROUTER_BASE_KEY — все объединяются в
//                                        один общий пул. При ЛЮБОЙ ошибке (лимиты, авторизация,
//                                        5xx, сеть) сервер молча пробует следующий ключ — клиент
//                                        никогда не видит, какой ключ и почему упал; получает либо
//                                        успешный ответ, либо один общий текст ошибки в конце.
//   ?action=openrouter-ping    (POST)  — лёгкий пинг модели (1 токен) для отображения скорости в UI
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

      // Retry on rate limits, server errors, and "no available channel" (503) — the
      // latter is a distributor/routing error on Agnes's side, often transient and
      // sometimes resolved by simply trying again or hitting a different key/channel.
      if ([429, 420, 500, 502, 503, 504].includes(upstream.status)) {
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
// Three selectable image models, replacing both the old single Agnes Image
// 2.1 Flash and Pixazo's Stable Diffusion XL. All three share the same
// endpoint/key pool and the same request shape (model + prompt + size + ratio
// + optional image[] for i2i) — see https://www.agnes-ai.com/en/docs/agnes-30-flash
// and the agnes-image-2.5-flash example the user provided.
const AGNES_IMAGE_MODELS = new Set(['agnes-image-2.5-flash', 'agnes-image-2.1-flash', 'agnes-image-2.0-flash']);

async function handleAgnesImage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AGNES_IMAGE_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
  const keyPool = getAgnesKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });

  try {
    const { prompt, model, imageUrls, size, ratio } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in request body' });

    const resolvedModel = AGNES_IMAGE_MODELS.has(model) ? model : 'agnes-image-2.5-flash';

    const payload = {
      model: resolvedModel,
      prompt,
      size: size || '2K',
      ratio: ratio || '1:1',
      extra_body: { response_format: 'url' },
    };
    // i2i: Agnes expects an array of PUBLIC image URLs, not base64 — the client
    // uploads to our own image-hosting endpoint first and sends the resulting URLs.
    if (Array.isArray(imageUrls) && imageUrls.length) {
      payload.image = imageUrls;
    }

    const data = await callWithRetry(AGNES_IMAGE_URL, payload, keyPool);

    const item = data?.data?.[0];
    if (item && item.url) return res.status(200).json({ url: item.url });
    if (item && item.b64_json) return res.status(200).json({ url: `data:image/png;base64,${item.b64_json}` });

    return res.status(502).json({ error: 'The image model is temporarily unavailable.' });
  } catch (err) {
    // Клиент при ошибке сам переключится на бесплатный Pollinations (см. script.js).
    // Никогда не прокидываем сырой текст апстрима (может быть JSON/HTML) наружу.
    return res.status(502).json({ error: 'The image model is temporarily unavailable.' });
  }
}

/* ============ agnes-video (agnes-video-2.5-flash, replaces v2.0 and Pixazo LTX) ============
   Docs: https://www.agnes-ai.com/en/docs/agnes-video-25-flash
   POST /v1/videos — seconds: "4".."12", mode: "text" | "image", size: "720P" only,
   aspect_ratio: one of 21:9, 16:9, 4:3, 1:1, 3:4, 9:16. Optional: first/last keyframes,
   up to 5 reference images, up to 3 custom audio tracks — all as PUBLIC URLs (the
   client uploads to our own image-hosting first; see uploadBase64ToHosting on the client). */
const AGNES_VIDEO_MODEL = 'agnes-video-2.5-flash';
const AGNES_VIDEO_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

async function handleAgnesVideo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const AGNES_VIDEO_URL = 'https://apihub.agnes-ai.com/v1/videos';
  const keyPool = getAgnesKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });

  try {
    const {
      prompt, seconds, aspectRatio,
      firstFrameUrl, lastFrameUrl, referenceUrls, audioUrls,
    } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing "prompt" in request body' });

    const dur = Math.min(12, Math.max(4, Math.round(Number(seconds) || 5)));
    const ratio = AGNES_VIDEO_RATIOS.has(aspectRatio) ? aspectRatio : '16:9';
    const hasKeyframe = !!(firstFrameUrl || lastFrameUrl);

    const payload = {
      model: AGNES_VIDEO_MODEL,
      prompt,
      seconds: String(dur),
      mode: hasKeyframe ? 'image' : 'text',
      size: '720P',
      aspect_ratio: ratio,
    };
    if (firstFrameUrl) payload.first_frame_url = firstFrameUrl;
    if (lastFrameUrl) payload.last_frame_url = lastFrameUrl;
    if (Array.isArray(referenceUrls) && referenceUrls.length) {
      payload.reference_images = referenceUrls.slice(0, 5);
    }
    if (Array.isArray(audioUrls) && audioUrls.length) {
      payload.audio_urls = audioUrls.slice(0, 3);
    }

    const data = await callWithRetry(AGNES_VIDEO_URL, payload, keyPool, 6);

    // The 2.5-flash API can respond already-completed (status: "completed" + url)
    // or still-running (an id to poll) depending on how fast it finishes.
    if (data.status === 'completed' && data.url) return res.status(200).json({ url: data.url });

    const videoId = data.id || data.video_id;
    if (!videoId) return res.status(502).json({ error: 'Agnes AI did not return a URL or task id.' });

    return res.status(200).json({ video_id: videoId });
  } catch (err) {
    // Never pass the raw upstream error text (can be JSON/HTML) to the client —
    // just a short, friendly message. The model itself was tried with every key
    // in the pool first (see callWithRetry above).
    return res.status(502).json({ error: 'The video model is temporarily unavailable. Please try again in a moment.' });
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
      // model_name is required by the 2.5-flash status endpoint.
      const upstream = await fetch(`${AGNES_VIDEO_POLL_URL}?video_id=${encodeURIComponent(video_id)}&model_name=${AGNES_VIDEO_MODEL}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (upstream.status === 429 || upstream.status === 420) continue;
      if (upstream.ok) {
        const data = await upstream.json();
        // Normalize the 2.5-flash "status" field (queued/pending/completed/failed) and
        // "url" into the shape the client already expects (status + url / video_url).
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

/* ============ openrouter (единый route для всех текстовых моделей чата) ============
   Silent key rotation: if OpenRouter returns any error (rate limit, auth, 5xx, etc.)
   the server just tries the next key in the pool — the client never sees which key
   failed or why, only the final successful response or a generic failure message. */
function getOpenrouterKeyPool() {
  const OPENROUTER_KEY = process.env.OPENROUTER_KEY;
  const OPENROUTER_BACKUP_KEYS = (process.env.OPENROUTER_BACKUP_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  // OPENROUTER_BASE_KEY (formerly reserved for the RU/Gemma route) now just joins
  // the same shared pool as an extra fallback key.
  const OPENROUTER_BASE_KEY = process.env.OPENROUTER_BASE_KEY;
  const pool = [];
  if (OPENROUTER_KEY) pool.push(OPENROUTER_KEY);
  pool.push(...OPENROUTER_BACKUP_KEYS);
  if (OPENROUTER_BASE_KEY) pool.push(OPENROUTER_BASE_KEY);
  return pool;
}

async function handleOpenrouter(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const keyPool = getOpenrouterKeyPool();

  if (!keyPool.length) return res.status(500).json({ error: 'No OpenRouter keys configured on the server' });

  const { model, messages, max_tokens } = req.body || {};
  if (!model || !messages) return res.status(400).json({ error: 'Missing "model" or "messages" in request body' });

  let lastStatus = 502;
  for (let attempt = 0; attempt < keyPool.length; attempt++) {
    const key = keyPool[attempt];
    try {
      const upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': process.env.SITE_URL || 'https://freebies-ai.site',
          'X-Title': 'Freebies',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: max_tokens || 800,
        }),
      });

      if (!upstream.ok) {
        lastStatus = upstream.status;
        continue; // silently try the next key — the client never sees this error
      }

      const data = await upstream.json().catch(() => null);
      if (!data) { continue; }
      return res.status(200).json(data);
    } catch (err) {
      lastStatus = 502;
      // network error on this key — silently move on to the next one
    }
  }

  // Every key failed — return one generic, non-revealing error.
  return res.status(lastStatus >= 400 && lastStatus < 600 ? lastStatus : 502).json({
    error: 'The AI model is temporarily unavailable. Please try again in a moment.',
  });
}

/* ============ openrouter-ping (лёгкий пинг модели для отображения скорости в UI) ============ */
async function handleOpenrouterPing(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
  const keyPool = getOpenrouterKeyPool();
  if (!keyPool.length) return res.status(500).json({ error: 'No OpenRouter keys configured on the server' });

  const { model } = req.body || {};
  if (!model) return res.status(400).json({ error: 'Missing "model" in request body' });

  const start = Date.now();
  for (let attempt = 0; attempt < keyPool.length; attempt++) {
    const key = keyPool[attempt];
    try {
      const upstream = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': process.env.SITE_URL || 'https://freebies-ai.site',
          'X-Title': 'Freebies',
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      });
      const ms = Date.now() - start;
      if (upstream.ok) return res.status(200).json({ ok: true, ms });
      continue; // try next key silently
    } catch (err) {
      continue;
    }
  }
  const ms = Date.now() - start;
  return res.status(200).json({ ok: false, ms });
}

/* ============ upload-media (Supabase Storage) ============
   Agnes's i2i, keyframe (first/last frame), reference-image, and custom-audio
   features all require PUBLIC URLs — base64 is not accepted for those modes.
   This route re-uses the same Supabase project already configured for auth
   (SUPABASE_URL + SUPABASE_SECRET_KEY) and uploads into a dedicated public
   bucket, then hands back the public URL for the client to pass along to
   agnes-image / agnes-video.
   Requires a public Storage bucket named "media" to exist in the Supabase
   project (Storage → New bucket → name "media" → Public bucket: on). */
async function handleUploadMedia(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const BUCKET = 'media';

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: 'Supabase is not configured on the server' });
  }

  try {
    const { base64, mimeType, kind } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'Missing "base64" in request body' });

    // Accept both raw base64 and full data: URIs.
    const commaIdx = base64.indexOf(',');
    const rawBase64 = base64.startsWith('data:') && commaIdx !== -1 ? base64.slice(commaIdx + 1) : base64;
    const contentType = mimeType || (kind === 'audio' ? 'audio/mpeg' : 'image/png');
    const ext = contentType.split('/')[1] || (kind === 'audio' ? 'mp3' : 'png');

    const buffer = Buffer.from(rawBase64, 'base64');
    // Basic size guard — Agnes inputs don't need to be huge, and this keeps the
    // function fast and the bucket tidy.
    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'File is too large (max 15MB).' });
    }

    const filename = `${kind === 'audio' ? 'audio' : 'img'}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${filename}`;

    const upstream = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'apikey': SUPABASE_SECRET_KEY,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: buffer,
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Upload failed. Please try again.' });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
    return res.status(200).json({ url: publicUrl });
  } catch (err) {
    return res.status(502).json({ error: 'Upload failed. Please try again.' });
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
  'upload-media': handleUploadMedia,
  'gemini': handleGemini,
  'openrouter': handleOpenrouter,
  'openrouter-ping': handleOpenrouterPing,
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
