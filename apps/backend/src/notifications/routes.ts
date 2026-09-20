import { z } from 'zod';
import { notificationsSchema } from '@thinkink/shared/contracts';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { authenticate, AuthFailure, body } from '../auth/request';
import { supabase } from '../auth/supabase';

export async function handleNotifications(request: Request, env: AuthEnv) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  });
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  try {
    const url = new URL(request.url);
    const reading =
      url.pathname === '/api/notifications/read' && request.method === 'POST';
    if (
      !reading &&
      !(url.pathname === '/api/notifications' && request.method === 'GET')
    )
      throw new AuthFailure(
        405,
        'METHOD_NOT_ALLOWED',
        'This method is not allowed.',
      );
    if (reading && !sameOrigin(request, env))
      throw new AuthFailure(
        403,
        'ORIGIN_REJECTED',
        'Reload Thinkink and try again.',
      );
    if (url.protocol !== 'https:' && !isLoopback(request.url))
      throw new AuthFailure(
        400,
        'HTTPS_REQUIRED',
        'A secure connection is required.',
      );
    if (!configured(env)) throw new Error('Unavailable');
    const identity = await authenticate(request, env, headers);
    if (!identity)
      throw new AuthFailure(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to see your notifications.',
      );
    const client = supabase(env, { token: identity.token });
    if (reading) {
      const input = z
        .object({ id: z.uuid().nullable() })
        .strict()
        .safeParse(await body(request));
      if (!input.success)
        throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid notification.');
      const result = await client.rpc('read_notifications', {
        notification_input: input.data.id,
      });
      if (result.error) throw result.error;
      return reply({ read: true });
    }
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .safeParse(url.searchParams.get('offset') ?? 0);
    if (!offset.success)
      throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid notification page.');
    const result = await client.rpc('my_notifications', {
      offset_input: offset.data,
    });
    if (result.error) throw result.error;
    return reply(notificationsSchema.parse(result.data));
  } catch (error) {
    if (error instanceof AuthFailure)
      return reply(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return reply(
      {
        error: {
          code: 'NOTIFICATIONS_UNAVAILABLE',
          message:
            'Notifications are temporarily unavailable. Please try again.',
        },
      },
      503,
    );
  }
}
