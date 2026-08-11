// Shared helper used by every /api/auth/* route.
// Uses the SECRET key (never expose this in frontend code) so it has
// full admin-level access to Supabase Auth + the profiles table.
const { createClient } = require('@supabase/supabase-js');

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
