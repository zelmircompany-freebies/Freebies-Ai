const { getSupabaseAdmin } = require('../_supabase');

// Only these fields may ever be written by the client — anything else in
// the request body is ignored, so a tampered request can't overwrite
// unrelated columns (e.g. email).
const ALLOWED_FIELDS = {
  stars: 'stars',
  name: 'name',
  dailyStars: 'daily_stars',
  dailyStarsDate: 'daily_stars_date',
  ugFreeUsesLeft: 'ug_free_uses_left',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, ...rest } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  try {
    const supabase = getSupabaseAdmin();

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    const userId = userData.user.id;

    const updates = {};
    for (const [clientKey, column] of Object.entries(ALLOWED_FIELDS)) {
      if (Object.prototype.hasOwnProperty.call(rest, clientKey)) {
        updates[column] = rest[clientKey];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (updateError) {
      console.error('save-profile error:', updateError);
      return res.status(500).json({ error: 'Could not save profile' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('save-profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
