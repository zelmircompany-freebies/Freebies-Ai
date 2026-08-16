const { getSupabaseAdmin } = require('../_supabase');

// Verifies the 6-digit OTP code the user received by email and exchanges
// it for a real session. This replaces the "click the magic link" step —
// the code itself is proof they own the inbox.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, token } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Введите корректный email' });
  }
  if (!token || typeof token !== 'string' || token.length < 6) {
    return res.status(400).json({ error: 'Введите код из письма' });
  }

  try {
    const supabase = getSupabaseAdmin();

    // 'email' type covers codes sent via signInWithOtp (both for existing
    // users and shouldCreateUser: true sign-ups).
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error || !data?.session || !data?.user) {
      return res.status(401).json({ error: 'Неверный или истёкший код. Запросите новый.' });
    }

    return res.status(200).json({
      user: { id: data.user.id, email: data.user.email },
      session: data.session, // contains access_token / refresh_token
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
