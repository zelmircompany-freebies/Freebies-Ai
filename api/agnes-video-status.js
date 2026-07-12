// Vercel Serverless Function
// Один запрос статуса генерации видео. Клиент (script.js) сам повторяет вызов
// этого эндпоинта с задержкой (см. POLL_INTERVAL) — здесь только прячем ключи.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const AGNES_KEY = process.env.AGNES_KEY;
  const AGNES_BACKUP_KEYS = (process.env.AGNES_BACKUP_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  const AGNES_VIDEO_POLL_URL = 'https://apihub.agnes-ai.com/agnesapi';

  if (!AGNES_KEY) {
    return res.status(500).json({ error: 'AGNES_KEY is not configured on the server' });
  }

  const { video_id } = req.query;
  if (!video_id) {
    return res.status(400).json({ error: 'Missing "video_id" query parameter' });
  }

  const keyPool = [AGNES_KEY, ...AGNES_BACKUP_KEYS];

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
