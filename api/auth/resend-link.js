const { getSupabaseAdmin } = require('../_supabase');

// Resends a fresh magic sign-in link (used by the "Resend link" button on
// the "check your email" screen).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Некорректный email' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const siteUrl = process.env.SITE_URL || 'https://freebies-ai.vercel.app';
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${siteUrl}/`,
      },
    });
    if (error) {
      console.error('Resend link error:', error);
      return res.status(500).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('resend-link error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
