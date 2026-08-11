const { getSupabaseAdmin } = require('../_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  try {
    const supabase = getSupabaseAdmin();

    // Verify the token server-side — never trust a user id sent by the client.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    const userId = userData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('name, stars, daily_stars, daily_stars_date, ug_free_uses_left')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('get-profile error:', profileError);
      return res.status(500).json({ error: 'Could not load profile' });
    }

    if (!profile) {
      // Shouldn't normally happen (created at register time), but handle
      // gracefully just in case.
      return res.status(200).json({ stars: null, name: null, dailyStars: 0, dailyStarsDate: null, ugFreeUsesLeft: null });
    }

    return res.status(200).json({
      name: profile.name,
      stars: profile.stars,
      dailyStars: profile.daily_stars,
      dailyStarsDate: profile.daily_stars_date,
      ugFreeUsesLeft: profile.ug_free_uses_left,
    });
  } catch (err) {
    console.error('get-profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
