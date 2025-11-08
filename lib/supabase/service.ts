// lib/supabase/service.ts
import { createClient } from '@supabase/supabase-js';

export { supabaseAdmin as serviceSupabase } from './admin';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'ts-service' } },
  });
}
mkdir -p lib/supabase
cat > lib/supabase/service.ts <<'TS'
/**
 * Minimal compatibility wrapper:
 * - default export: supabaseAdmin
 * - named export:  serviceSupabase
 * - also re-export supabaseAdmin itself
 */
export { supabaseAdmin } from './admin';
export { supabaseAdmin as serviceSupabase } from './admin';
export { supabaseAdmin as default } from './admin';