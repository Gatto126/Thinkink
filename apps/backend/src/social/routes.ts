import { z } from 'zod';
import {
  favoriteListSchema,
  reactionSchema,
  topicSocialSchema,
} from '@thinkink/shared/contracts';
import { authenticate, AuthFailure, body } from '../auth/request';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { supabase } from '../auth/supabase';
import { commentRoomTopic, notifyTopicRoom } from '../discussion/realtime';

export async function handleSocial(request: Request, env: AuthEnv) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  });
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  try {
    const url = new URL(request.url);
    const topic = /^\/api\/topics\/([^/]+)\/social$/.exec(url.pathname);
    const comment = /^\/api\/comments\/([^/]+)\/like$/.exec(url.pathname);
    const listing = url.pathname === '/api/favorites';
    if (
      !(listing && request.method === 'GET') &&
      !(topic && ['GET', 'PUT'].includes(request.method)) &&
      !(comment && request.method === 'PUT')
    )
      throw new AuthFailure(
        405,
        'METHOD_NOT_ALLOWED',
        'This method is not allowed.',
      );
    if (request.method !== 'GET' && !sameOrigin(request, env))
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
    const id = listing ? null : z.uuid().safeParse((topic ?? comment)![1]);
    if (id && !id.success)
      throw new AuthFailure(
        404,
        'NOT_FOUND',
        'This content could not be found.',
      );
    if (!configured(env)) throw new Error('Unavailable');
    const identity = await authenticate(request, env, headers);
    if (!identity && (listing || request.method !== 'GET'))
      throw new AuthFailure(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to save favorites and like comments.',
      );
    const client = supabase(env, identity ? { token: identity.token } : {});
    let result;
    if (listing) {
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .safeParse(url.searchParams.get('offset') ?? 0);
      if (!offset.success)
        throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid page.');
      result = await client.rpc('my_favorites', { offset_input: offset.data });
    } else if (request.method === 'GET')
      result = await client.rpc('topic_social', { topic_input: id!.data });
    else {
      const input = z
        .object({ selected: z.boolean() })
        .strict()
        .safeParse(await body(request));
      if (!input.success)
        throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid selection.');
      result = await client.rpc(
        topic ? 'set_topic_favorite' : 'set_comment_like',
        topic
          ? { topic_input: id!.data, favorite_input: input.data.selected }
          : { comment_input: id!.data, liked_input: input.data.selected },
      );
    }
    if (result.error) {
      if (result.error.code === 'P0002')
        throw new AuthFailure(
          404,
          'NOT_FOUND',
          'This content is no longer available.',
        );
      throw result.error;
    }
    if (listing) {
      const items = (result.data.items ?? []).map(
        (item: Record<string, unknown>) => ({
          ...item,
          createdAt: new Date(String(item.createdAt)).toISOString(),
          updatedAt: item.updatedAt
            ? new Date(String(item.updatedAt)).toISOString()
            : null,
        }),
      );
      return reply(favoriteListSchema.parse({ ...result.data, items }));
    }
    if (comment)
      await notifyTopicRoom(env, await commentRoomTopic(env, id!.data!));
    return reply(
      (topic ? topicSocialSchema : reactionSchema).parse(result.data),
    );
  } catch (error) {
    if (error instanceof AuthFailure)
      return reply(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return reply(
      {
        error: {
          code: 'SOCIAL_UNAVAILABLE',
          message: 'Could not load or save this selection. Please try again.',
        },
      },
      503,
    );
  }
}
