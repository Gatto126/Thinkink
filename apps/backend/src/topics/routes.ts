import { ensureReaderCookie } from '../discussion/visits';
import { z } from 'zod';
import {
  createTopicSchema,
  topicTitleSchema,
} from '@thinkink/shared/contracts';
import type { TopicData } from '@thinkink/shared/contracts';
import type { AuthEnv } from '../auth/config';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import { authenticate, AuthFailure, body } from '../auth/request';
import { supabase } from '../auth/supabase';
import { prepareContent, readContent } from '../content/service';

interface TopicRow {
  id: string;
  title: string;
  created_at: string;
}
const projection = 'id,title,created_at';
function topic(row: TopicRow): TopicData {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    summary: null,
    summaryCheckedAt: null,
    news: [],
    newsCheckedAt: null,
    newsRevision: 0,
    contentStatus: 'idle',
    contentRetryAt: null,
  };
}

export async function handleTopics(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  async function withActivity(value: TopicData) {
    const result = await supabase(env).rpc('topic_activity', {
      topic_inputs: [value.id],
    });
    if (result.error) throw result.error;
    const stats = result.data?.[0];
    return {
      ...value,
      visits: Number(stats?.visits ?? 0),
      commentCount: Number(stats?.comment_count ?? 0),
    };
  }
  const url = new URL(request.url);
  const creating = url.pathname === '/api/topics';
  const preparing = /^\/api\/topics\/([^/]+)\/prepare$/.exec(url.pathname);
  const mutation = creating || Boolean(preparing);
  try {
    const method = mutation ? 'POST' : 'GET';
    if (request.method !== method) {
      headers.set('Allow', method);
      throw new AuthFailure(
        405,
        'METHOD_NOT_ALLOWED',
        'This method is not allowed.',
      );
    }
    if (mutation && !sameOrigin(request, env))
      throw new AuthFailure(
        403,
        'ORIGIN_REJECTED',
        'Reload Thinkink and try again.',
      );
    if (mutation && url.protocol !== 'https:' && !isLoopback(request.url))
      throw new AuthFailure(
        400,
        'HTTPS_REQUIRED',
        'A secure connection is required.',
      );
    if (!configured(env)) throw new Error('Catalogue unavailable');
    const client = supabase(env);
    if (preparing) {
      const id = z.uuid().safeParse(preparing[1]);
      if (!id.success)
        throw new AuthFailure(
          404,
          'TOPIC_NOT_FOUND',
          'This topic could not be found.',
        );
      const identity = await authenticate(request, env, headers);
      if (!identity)
        throw new AuthFailure(
          401,
          'SIGN_IN_REQUIRED',
          'Sign in to prepare this topic.',
        );
      const permission = await supabase(env, { token: identity.token }).rpc(
        'can_delete_topic',
        { topic_input: id.data },
      );
      if (permission.error) throw permission.error;
      if (!permission.data)
        throw new AuthFailure(
          403,
          'NOT_ALLOWED',
          'Only the creator or a moderator can prepare this topic.',
        );
      const { data, error } = await client
        .from('topics')
        .select(projection)
        .eq('id', id.data)
        .maybeSingle();
      if (error || !data)
        throw new AuthFailure(
          404,
          'TOPIC_NOT_FOUND',
          'This topic could not be found.',
        );
      await prepareContent(env, topic(data), identity.user.id, true);
      return reply(await withActivity(await readContent(env, topic(data))));
    }
    if (url.pathname === '/api/home') {
      const { data, error } = await client.rpc('home_topics');
      if (error) throw error;
      const latest = (data ?? []).map(
        (
          row: TopicRow & {
            excerpt: string | null;
            creator_username: string | null;
            updated_at: string | null;
          },
        ) => ({
          id: row.id,
          title: row.title,
          createdAt: new Date(row.created_at).toISOString(),
          excerpt: row.excerpt ?? null,
          creatorUsername: row.creator_username ?? null,
          updatedAt: new Date(row.updated_at ?? row.created_at).toISOString(),
        }),
      );
      const mostVisited = await readPopular(env);
      const ids = [
        ...new Set([...latest, ...mostVisited].map((item) => item.id)),
      ];
      const activity = ids.length
        ? await client.rpc('topic_activity', { topic_inputs: ids })
        : { data: [], error: null };
      if (activity.error) throw activity.error;
      const counts = new Map<string, { visits: number; commentCount: number }>(
        (activity.data ?? []).map(
          (row: {
            topic_id: string;
            visits: number;
            comment_count: number;
          }) => [
            row.topic_id,
            {
              visits: Number(row.visits),
              commentCount: Number(row.comment_count),
            },
          ],
        ),
      );
      const enrich = (item: (typeof latest)[number]) => ({
        ...item,
        ...(counts.get(item.id) ?? { visits: 0, commentCount: 0 }),
      });
      return reply({
        latest: latest.map(enrich),
        mostVisited: mostVisited.map(enrich),
      });
    }
    if (creating) {
      const identity = await authenticate(request, env, headers);
      if (!identity)
        throw new AuthFailure(
          401,
          'SIGN_IN_REQUIRED',
          'Sign in to start a new topic.',
        );
      const input = createTopicSchema.safeParse(await body(request));
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Enter a topic between 2 and 160 characters.',
        );
      const { data, error } = await supabase(env, {
        token: identity.token,
      }).rpc('create_topic', { title_input: input.data.title });
      if (error?.code === 'PT429')
        throw new AuthFailure(
          429,
          'TOPIC_DAILY_LIMIT',
          'You can create 5 topics per day. Try again after midnight (Europe/Rome).',
        );
      if (error || !data?.[0]) throw error ?? new Error('Topic not returned');
      await prepareContent(env, topic(data[0]), identity.user.id);
      return reply(await withActivity(await readContent(env, topic(data[0]))));
    }
    if (url.pathname === '/api/topics/search') {
      const input = topicTitleSchema.safeParse(url.searchParams.get('q'));
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Enter a topic between 2 and 160 characters.',
        );
      const { data, error } = await client.rpc('search_topics', {
        query_input: input.data,
      });
      if (error) throw error;
      return reply({
        topics: (data ?? []).map((row: TopicRow) => ({
          id: row.id,
          title: row.title,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      });
    }
    if (url.pathname === '/api/topics/resolve') {
      const input = topicTitleSchema.safeParse(url.searchParams.get('q'));
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          'Enter a topic between 2 and 160 characters.',
        );
      const { data, error } = await client.rpc('find_topic', {
        title_input: input.data,
      });
      if (error) throw error;
      if (!data?.[0])
        throw new AuthFailure(
          404,
          'TOPIC_NOT_FOUND',
          'This topic hasn’t been started yet.',
        );
      return reply(await withActivity(await readContent(env, topic(data[0]))));
    }
    const id = z.uuid().safeParse(url.pathname.slice('/api/topics/'.length));
    if (!id.success)
      throw new AuthFailure(
        404,
        'TOPIC_NOT_FOUND',
        'This topic could not be found.',
      );
    const { data, error } = await client
      .from('topics')
      .select(projection)
      .eq('id', id.data)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new AuthFailure(
        404,
        'TOPIC_NOT_FOUND',
        'This topic could not be found.',
      );
    await ensureReaderCookie(request, env, headers);
    return reply(await withActivity(await readContent(env, topic(data))));
  } catch (error) {
    if (error instanceof AuthFailure)
      return reply(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return reply(
      {
        error: {
          code: 'CATALOG_UNAVAILABLE',
          message: 'Topics are temporarily unavailable. Please try again.',
        },
      },
      503,
    );
  }
}

async function readPopular(env: AuthEnv) {
  const { data, error } = await supabase(env).rpc('popular_topics');
  if (error) throw error;
  return (data ?? []).map(
    (
      row: TopicRow & {
        creator_username: string | null;
        excerpt: string | null;
        updated_at: string;
        visits: number;
      },
    ) => ({
      id: row.id,
      title: row.title,
      createdAt: new Date(row.created_at).toISOString(),
      creatorUsername: row.creator_username,
      excerpt: row.excerpt,
      updatedAt: new Date(row.updated_at).toISOString(),
      visits: Number(row.visits),
    }),
  );
}
