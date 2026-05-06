import { createClient } from '@supabase/supabase-js';

const w = (typeof window !== 'undefined' ? window : {}) as any;
const supabaseUrl = w.__env__?.SUPABASE_URL || (import.meta.env.VITE_SUPABASE_URL as string);
const supabasePublishableKey = w.__env__?.SUPABASE_PUBLISHABLE_KEY || (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
