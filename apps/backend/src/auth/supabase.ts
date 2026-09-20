import { createClient } from '@supabase/supabase-js';
import type { AuthEnv } from './config';

// Clients are request scoped; no session state is shared between Worker requests.
export function supabase(
  env: AuthEnv,
  options: { admin?: boolean; token?: string } = {},
) {
  return createClient(
    env.SUPABASE_URL!,
    options.admin ? env.SUPABASE_SECRET_KEY! : env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: options.token
          ? { Authorization: `Bearer ${options.token}` }
          : {},
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(10000),
          }),
      },
    },
  );
}
