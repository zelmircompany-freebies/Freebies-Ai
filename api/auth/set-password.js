const { getSupabaseAdmin } = require('../_supabase');

const NEW_ACCOUNT_BONUS_STARS = 110;

// Called right after the user clicks the magic link and lands back on the
// site with a valid session (access_token in the URL, already exchanged
// client-side). The token itself is proof they own the inbox — this route
// verifies it server-side, then attaches a password to the account so they
// can log in normally next time, and creates the profile row on first use.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, password } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Missing session token' });
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Verify the token server-side — never trust a user id sent by the client.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Сессия истекла. Запросите новую ссылку.' });
    }
    const user = userData.user;

    const { error: pwError } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: { ...(user.user_metadata || {}), password_set: true },
    });
    if (pwError) {
      console.error('Set password error:', pwError);
      return res.status(500).json({ error: 'Не удалось задать пароль. Попробуйте ещё раз.' });
    }

    // Create the profile row if it doesn't exist yet (first-time signup).
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('name, stars, daily_stars, daily_stars_date, ug_free_uses_left')
      .eq('id', user.id)
      .maybeSingle();

    let profile = existingProfile;
    if (!profile) {
      const name = (user.email || '').split('@')[0] || 'User';
      await supabase.from('profiles').insert({
        id: user.id,
        email: user.email,
        name,
        stars: NEW_ACCOUNT_BONUS_STARS,
        daily_stars: 0,
        daily_stars_date: null,
        ug_free_uses_left: null,
      });
      profile = { name, stars: NEW_ACCOUNT_BONUS_STARS, daily_stars: 0, daily_stars_date: null, ug_free_uses_left: null };
    }

    return res.status(200).json({
      user: { id: user.id, email: user.email },
      profile: {
        name: profile.name,
        stars: profile.stars,
        dailyStars: profile.daily_stars,
        dailyStarsDate: profile.daily_stars_date,
        ugFreeUsesLeft: profile.ug_free_uses_left,
      },
    });
  } catch (err) {
    console.error('set-password error:', err);
    return res.status(500).json({ error: 'Ошибка сервера. Попробуйте позже.' });
  }
};
