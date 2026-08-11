const { getSupabaseAdmin } = require('../_supabase');

// Sends a magic sign-in link to the given email. Nothing about the account
// (including a password) exists yet in a usable form — the user only
// becomes a real, logged-in account once they click the link in their
// inbox (handled client-side) and then set a password via set-password.js.
// This is what proves they actually own the address.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // TEMP DIAGNOSTIC — remove once the 400 issue is resolved.
  console.log('DEBUG register.js incoming body:', JSON.stringify(req.body));
  console.log('DEBUG register.js content-type header:', req.headers['content-type']);

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    // TEMP DIAGNOSTIC — remove once the 400 issue is resolved.
    console.log('DEBUG register.js rejected: email was', typeof email, JSON.stringify(email));
    return res.status(400).json({ error: 'Введите корректный email' });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Don't let someone "re-register" over an account that already has a
    // password set (i.e. has already completed onboarding).
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (existing && existing.user_metadata?.password_set) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован. Попробуйте войти.' });
    }

    const siteUrl = process.env.SITE_URL || 'https://freebies-ai.vercel.app';
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${siteUrl}/`,
      },
    });

    if (otpError) {
      console.error('Magic link send error:', otpError);
      return res.status(500).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }

    return res.status(200).json({ success: true, email });
  } catch (err) {
    console.error('Register (send-link) error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
