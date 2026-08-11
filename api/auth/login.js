const { getSupabaseAdmin } = require('../_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Введите email и пароль' });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Fetch (or lazily create) the profile row.
    let { data: profile } = await supabase
      .from('profiles')
      .select('name, stars, daily_stars, daily_stars_date, ug_free_uses_left')
      .eq('id', data.user.id)
      .maybeSingle();

    if (!profile) {
      const NEW_ACCOUNT_BONUS_STARS = 110;
      const fallbackName = email.split('@')[0];
      await supabase.from('profiles').insert({
        id: data.user.id,
        email: data.user.email,
        name: fallbackName,
        stars: NEW_ACCOUNT_BONUS_STARS,
      });
      profile = { name: fallbackName, stars: NEW_ACCOUNT_BONUS_STARS, daily_stars: 0, daily_stars_date: null, ug_free_uses_left: null };
    }

    return res.status(200).json({
      user: { id: data.user.id, email: data.user.email },
      session: data.session,
      profile: {
        name: profile.name,
        stars: profile.stars,
        dailyStars: profile.daily_stars,
        dailyStarsDate: profile.daily_stars_date,
        ugFreeUsesLeft: profile.ug_free_uses_left,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
