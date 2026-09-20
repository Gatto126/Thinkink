import { z } from 'zod';
import {
  commentListSchema,
  reactionSchema,
  commentLocationSchema,
  createCommentSchema,
} from '@thinkink/shared/contracts';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { authenticate, AuthFailure, body } from '../auth/request';
import { supabase } from '../auth/supabase';
import { commentRoomTopic, notifyTopicRoom } from './realtime';

export async function handleComments(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  });
  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  try {
    const url = new URL(request.url);
    const thread = /^\/api\/topics\/([^/]+)\/comments$/.exec(url.pathname);
    const comment = /^\/api\/comments\/([^/]+)$/.exec(url.pathname);
    if (
      (!thread || !['GET', 'POST'].includes(request.method)) &&
      (!comment || request.method !== 'DELETE')
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
    const id = z.uuid().safeParse((thread ?? comment)![1]);
    if (!id.success)
      throw new AuthFailure(
        404,
        'NOT_FOUND',
        'This conversation could not be found.',
      );
    if (!configured(env)) throw new Error('Unavailable');
    const identity = await authenticate(request, env, headers);
    if (!identity && request.method !== 'GET')
      throw new AuthFailure(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to join the conversation.',
      );
    const client = supabase(env, identity ? { token: identity.token } : {});
    const check = (error: { code?: string; message?: string } | null) => {
      if (!error) return;
      const status =
        error.code === '42501'
          ? 403
          : error.code === 'PT429'
            ? 429
            : error.code === 'P0002'
              ? 404
              : error.code === '22023'
                ? 400
                : 503;
      throw new AuthFailure(
        status,
        'COMMENT_UNAVAILABLE',
        status === 503
          ? 'Comments are temporarily unavailable.'
          : (error.message ?? 'Please try again.'),
      );
    };
    if (comment) {
      if (
        !z
          .object({ confirmation: z.literal(true) })
          .strict()
          .safeParse(await body(request)).success
      )
        throw new AuthFailure(
          400,
          'CONFIRMATION_REQUIRED',
          'Confirm comment deletion.',
        );
      const topicId = await commentRoomTopic(env, id.data);
      const result = await client.rpc('delete_own_comment', {
        comment_input: id.data,
      });
      check(result.error);
      await notifyTopicRoom(env, topicId);
      return reply({ deleted: true });
    }
    if (request.method === 'POST') {
      const input = createCommentSchema.safeParse(await body(request, 32768));
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Write a comment between 1 and 5000 characters.',
        );
      const result = await client.rpc('add_comment', {
        topic_input: id.data,
        comment_input: input.data.id,
        body_input: input.data.body,
        parent_input: input.data.parentId,
      });
      check(result.error);
      await notifyTopicRoom(env, id.data);
      return reply({ id: result.data }, 201);
    }
    if (url.searchParams.has('locate')) {
      const target = z.uuid().safeParse(url.searchParams.get('locate'));
      if (!target.success)
        throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid comment.');
      const result = await client.rpc('comment_location', {
        topic_input: id.data,
        comment_input: target.data,
      });
      check(result.error);
      return reply(commentLocationSchema.parse(result.data));
    }
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .safeParse(url.searchParams.get('offset') ?? 0);
    if (!offset.success)
      throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid comment page.');
    const threadId = z
      .uuid()
      .nullable()
      .safeParse(url.searchParams.get('thread'));
    if (!threadId.success)
      throw new AuthFailure(400, 'INVALID_INPUT', 'Invalid conversation.');
    const result =
      threadId.data || url.searchParams.get('threaded') === 'true'
        ? await client.rpc('topic_comment_threads', {
            topic_input: id.data,
            offset_input: offset.data,
            thread_input: threadId.data,
          })
        : await client.rpc('topic_comments', {
            topic_input: id.data,
            offset_input: offset.data,
          });
    check(result.error);
    const page = commentListSchema.parse(result.data);
    const ids = page.items.flatMap((item) =>
      item.firstReply ? [item.id, item.firstReply.id] : [item.id],
    );
    if (ids.length) {
      const reactions = await client.rpc('comment_reactions', {
        comment_inputs: ids,
      });
      check(reactions.error);
      const byId = new Map(
        z
          .array(reactionSchema)
          .parse(reactions.data)
          .map((item) => [item.id, item]),
      );
      page.items = page.items.map((item) => ({
        ...item,
        ...byId.get(item.id),
        firstReply: item.firstReply
          ? { ...item.firstReply, ...byId.get(item.firstReply.id) }
          : item.firstReply,
      }));
    }
    return reply(page);
  } catch (error) {
    if (error instanceof AuthFailure)
      return reply(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return reply(
      {
        error: {
          code: 'COMMENTS_UNAVAILABLE',
          message: 'Comments are temporarily unavailable. Please try again.',
        },
      },
      503,
    );
  }
}
