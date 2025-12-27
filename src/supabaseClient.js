import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('🔧 Supabase Configuration:', {
  url: supabaseUrl ? `${supabaseUrl.slice(0, 30)}...` : 'NOT SET',
  keyPresent: Boolean(supabaseKey),
  isConfigured: Boolean(supabaseUrl && supabaseKey)
});

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;
