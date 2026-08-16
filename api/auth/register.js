const { getSupabaseAdmin } = require('../_supabase');

// Sends a sign-in code to the given email. Nothing about the account
// (including a password) exists yet in a usable form — the user only
// becomes a real, logged-in account once they enter the code they
// received (verified client-side via verify-otp.js) and then set a
// password via set-password.js. This is what proves they actually own
// the address.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
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

    // No emailRedirectTo here on purpose: as soon as a redirect URL is
    // present, Supabase leans towards sending a clickable magic link.
    // We want the numeric code instead — that comes from the
    // "Confirm signup" / "Magic Link or OTP" templates using {{ .Token }}.
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (otpError) {
      console.error('OTP send error:', otpError);
      return res.status(500).json({ error: 'Не удалось отправить письмо. Попробуйте позже.' });
    }

    return res.status(200).json({ success: true, email });
  } catch (err) {
    console.error('Register (send-code) error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
