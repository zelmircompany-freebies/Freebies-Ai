const { getSupabaseAdmin } = require('../_supabase');

// Resends a fresh sign-in code (used by the "Resend code" button on
// the code-entry screen).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Некорректный email' });
  }

  try {
    const supabase = getSupabaseAdmin();
    // No emailRedirectTo here either, for the same reason as register.js —
    // we want the numeric code, not a clickable link.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });
    if (error) {
      console.error('Resend code error:', error);
      return res.status(500).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('resend-link error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
