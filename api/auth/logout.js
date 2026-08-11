const { getSupabaseAdmin } = require('../_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(200).json({ success: true }); // nothing to revoke

  try {
    const supabase = getSupabaseAdmin();
    await supabase.auth.admin.signOut(token).catch(() => {});
    return res.status(200).json({ success: true });
  } catch (err) {
    // Best-effort: the frontend already cleared its local session either way.
    return res.status(200).json({ success: true });
  }
};
