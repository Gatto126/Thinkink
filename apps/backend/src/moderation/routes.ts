import { z } from 'zod';
import { editOverviewSchema, overviewSchema } from '@thinkink/shared/contracts';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { authenticate, AuthFailure, body } from '../auth/request';
import { supabase } from '../auth/supabase';
import { providersEnabled } from '../content/service';
import { commentRoomTopic, notifyTopicRoom } from '../discussion/realtime';

export async function handleModeration(
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
  const url = new URL(request.url);
  const permissions = /^\/api\/topics\/([^/]+)\/permissions$/.exec(
    url.pathname,
  );
  const overview = /^\/api\/topics\/([^/]+)\/overview$/.exec(url.pathname);
  const topic = /^\/api\/topics\/([^/]+)$/.exec(url.pathname);
  const comment = /^\/api\/moderation\/comments\/([^/]+)$/.exec(url.pathname);
  const user = /^\/api\/moderation\/users\/([^/]+)$/.exec(url.pathname);
  const listing = /^\/api\/moderation\/(topics|comments|users)$/.exec(
    url.pathname,
  );
  const owned = url.pathname === '/api/account/topics';
  const budget = url.pathname === '/api/moderation/budget';
  try {
    if (
      !permissions &&
      !topic &&
      !comment &&
      !user &&
      !listing &&
      !owned &&
      !budget &&
      !overview
    )
      throw new AuthFailure(404, 'NOT_FOUND', 'This endpoint does not exist.');
    const method = overview
      ? 'PATCH'
      : budget
        ? request.method === 'PATCH'
          ? 'PATCH'
          : 'GET'
        : permissions || listing || owned
          ? 'GET'
          : 'DELETE';
    if (request.method !== method) {
      headers.set('Allow', method);
      throw new AuthFailure(
        405,
        'METHOD_NOT_ALLOWED',
        'This method is not allowed.',
      );
    }
    if (method !== 'GET' && !sameOrigin(request, env))
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
        'Sign in to manage content.',
      );
    const client = supabase(env, { token: identity.token });
    let result;
    let changedTopic: string | null = null;
    if (overview) {
      const id = z.uuid().safeParse(overview[1]);
      const input = editOverviewSchema.safeParse(await body(request, 262144));
      if (!id.success || !input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Check the overview title and paragraphs.',
        );
      const result = await client.rpc('edit_topic_overview', {
        topic_input: id.data,
        revision_input: input.data.revision,
        headline_input: input.data.headline,
        paragraphs_input: input.data.paragraphs,
      });
      if (result.error) {
        if (result.error.code === '42501')
          throw new AuthFailure(
            403,
            'NOT_ALLOWED',
            'Moderator access required.',
          );
        if (result.error.code === '40001')
          throw new AuthFailure(
            409,
            'OVERVIEW_CHANGED',
            'Another administrator changed this overview. Reload the page before editing again.',
          );
        if (result.error.code === 'P0002')
          throw new AuthFailure(
            404,
            'NOT_FOUND',
            'This overview is no longer available.',
          );
        if (result.error.code === '22023')
          throw new AuthFailure(
            400,
            'INVALID_INPUT',
            'Check the overview text and source references.',
          );
        throw result.error;
      }
      return reply(overviewSchema.parse(result.data));
    }
    if (budget) {
      if (method === 'PATCH') {
        const input = z
          .object({ paused: z.boolean() })
          .strict()
          .safeParse(await body(request));
        if (!input.success)
          throw new AuthFailure(
            400,
            'INVALID_INPUT',
            'Choose whether new content is paused.',
          );
        const update = await client.rpc('pause_content_providers', {
          paused_input: input.data.paused,
        });
        if (update.error) {
          if (update.error.code === '42501')
            throw new AuthFailure(
              403,
              'NOT_ALLOWED',
              'Moderator access required.',
            );
          throw update.error;
        }
      }
      result = await client.rpc('content_budget_status');
    } else if (listing || owned) {
      const input = z
        .object({
          query: z.string().trim().max(160),
          offset: z.coerce.number().int().min(0).max(100000),
        })
        .safeParse({
          query: url.searchParams.get('q') ?? '',
          offset: url.searchParams.get('offset') ?? 0,
        });
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Check the search filters.',
        );
      result = owned
        ? await client.rpc('owned_topics', { offset_input: input.data.offset })
        : listing![1] === 'users'
          ? await client.rpc('moderation_users', {
              query_input: input.data.query,
              offset_input: input.data.offset,
            })
          : await client.rpc('moderation_list', {
              kind_input: listing![1],
              query_input: input.data.query,
              offset_input: input.data.offset,
            });
    } else {
      const id = z
        .uuid()
        .safeParse((permissions ?? topic ?? comment ?? user)![1]);
      if (!id.success)
        throw new AuthFailure(
          404,
          'NOT_FOUND',
          'This content could not be found.',
        );
      if (
        !permissions &&
        !z
          .object({ confirmation: z.literal(true) })
          .strict()
          .safeParse(await body(request)).success
      )
        throw new AuthFailure(
          400,
          'CONFIRMATION_REQUIRED',
          'Confirm permanent deletion.',
        );
      changedTopic = comment
        ? await commentRoomTopic(env, id.data)
        : topic && !permissions
          ? id.data
          : null;
      result = permissions
        ? await client.rpc('can_delete_topic', { topic_input: id.data })
        : topic
          ? await client.rpc('delete_topic', { topic_input: id.data })
          : user
            ? await client.rpc('moderate_user', { user_input: id.data })
            : await client.rpc('moderate_comment', { comment_input: id.data });
    }
    if (result.error) {
      if (user && result.error.code === '22023')
        throw new AuthFailure(
          400,
          'SELF_DELETION_DENIED',
          'You cannot delete your own account from the admin console.',
        );
      if (user && result.error.code === 'P0002')
        throw new AuthFailure(
          404,
          'NOT_FOUND',
          'This user no longer exists. Refresh the list.',
        );
      if (result.error.code === '42501')
        throw new AuthFailure(
          403,
          'NOT_ALLOWED',
          'You do not have permission to manage this content.',
        );
      throw result.error;
    }
    if (budget)
      return reply({ ...result.data, enabled: providersEnabled(env) });
    if (listing || owned) return reply(result.data);
    await notifyTopicRoom(env, changedTopic);
    return reply(
      permissions ? { canDelete: result.data === true } : { deleted: true },
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
          code: 'CONTENT_UNAVAILABLE',
          message: 'Content could not be managed. Please try again.',
        },
      },
      503,
    );
  }
}
