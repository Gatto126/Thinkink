import { avatarCatalogSchema } from '@thinkink/shared/contracts';
import type { AuthEnv } from './config';
import { configured } from './config';
import { supabase } from './supabase';

export async function handleAvatarCatalog(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method !== 'GET')
    return Response.json(
      {
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'This method is not allowed.',
        },
      },
      { status: 405, headers: { ...headers, Allow: 'GET' } },
    );
  try {
    if (!configured(env)) throw new Error('Not configured');
    const { data, error } = await supabase(env)
      .from('avatar_options')
      .select('id,label,src')
      .eq('available', true)
      .order('sort_order')
      .order('id');
    if (error) throw error;
    return Response.json(avatarCatalogSchema.parse({ avatars: data }), {
      headers,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: 'AVATARS_UNAVAILABLE',
          message:
            'The avatar collection could not be loaded. Please try again.',
        },
      },
      { status: 503, headers },
    );
  }
}
