const { getSupabaseAdmin } = require('../_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Введите корректный email' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Create the user directly (no email confirmation step, so login works
    // immediately after registration).
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const msg = /already registered|already exists/i.test(createError.message)
        ? 'Этот email уже зарегистрирован'
        : createError.message;
      return res.status(409).json({ error: msg });
    }

    const user = created.user;

    // Create the profile row with the starting bonus.
    const NEW_ACCOUNT_BONUS_STARS = 110;
    const { error: profileError } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email,
      name: email.split('@')[0],
      stars: NEW_ACCOUNT_BONUS_STARS,
      daily_stars: 0,
      daily_stars_date: null,
      ug_free_uses_left: null,
    });
    if (profileError) {
      console.error('Profile insert failed:', profileError);
      // Not fatal for the sign-up itself — get-profile will lazily create
      // it later if this row is missing.
    }

    // Sign the user in immediately so the frontend gets a session/token.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      return res.status(500).json({ error: 'Регистрация прошла, но не удалось войти. Попробуйте войти вручную.' });
    }

    return res.status(201).json({
      user: { id: user.id, email: user.email },
      session: signInData.session,
      profile: { name: email.split('@')[0], stars: NEW_ACCOUNT_BONUS_STARS },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
