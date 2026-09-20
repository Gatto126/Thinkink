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
        fetch: async (input, init) => {
          if (init?.signal) return fetch(input, init);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetch(input, {
              ...init,
              signal: controller.signal,
            });
            // Supabase endpoints return finite JSON, not streams. Keep the
            // deadline through body consumption, then release its timer.
            const payload = response.body ? await response.arrayBuffer() : null;
            return new Response(payload, response);
          } finally {
            // An outstanding timeout prevents a room from hibernating, even
            // after its database request has finished.
            clearTimeout(timer);
          }
        },
      },
    },
  );
}
