import { z } from 'zod';
import { sourceSchema, topicSchema } from '@thinkink/shared/contracts';
import type { TopicData } from '@thinkink/shared/contracts';
import type { AuthEnv } from '../auth/config';
import { supabase } from '../auth/supabase';
import {
  articleSchema,
  checkFreeAvailability,
  configuredModels,
  fetchNews,
  fetchOverview,
  ProviderFailure,
} from './providers';
import type { Article } from './providers';
import { publicationDate } from './publication';
import { resolveArticleImages } from './images';

export const providersEnabled = (env: AuthEnv) =>
  env.AUTOMATED_TEST_MODE !== 'true' &&
  env.CONTENT_PROVIDERS_ENABLED === 'true' &&
  Boolean(
    env.SERPER_API_KEY && env.OPENROUTER_API_KEY && env.SUPABASE_SECRET_KEY,
  );
const iso = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;
export async function readContent(
  env: AuthEnv,
  topic: TopicData,
): Promise<TopicData> {
  const { data, error } = await supabase(env)
    .from('topic_content')
    .select(
      'news,news_checked_at,news_revision,summary,model,status,lease_until,next_attempt_at',
    )
    .eq('topic_id', topic.id)
    .maybeSingle();
  if (error) throw new Error('Content unavailable');
  if (!data) return topic;
  const expired =
    data.status === 'preparing' &&
    (!data.lease_until || Date.parse(data.lease_until) < Date.now());
  return topicSchema.parse({
    ...topic,
    news: (data.news ?? []).map((source: unknown) => {
      const article = sourceSchema.parse(source);
      const label = z
        .object({ dateLabel: z.string().nullable().optional() })
        .parse(source).dateLabel;
      return article.publishedAt
        ? article
        : { ...article, ...publicationDate(label, data.news_checked_at) };
    }),
    summary: data.summary
      ? { ...data.summary, model: data.model ?? null }
      : null,
    newsCheckedAt: iso(data.news_checked_at),
    summaryCheckedAt: data.summary?.generatedAt ?? null,
    newsRevision: data.news_revision ?? 0,
    contentStatus: expired ? 'error' : data.status,
    contentRetryAt: iso(data.next_attempt_at),
  });
}

export async function prepareContent(
  env: AuthEnv,
  topic: TopicData,
  actor: string,
  manual = false,
): Promise<void> {
  if (!providersEnabled(env)) return;
  // Validate configuration before claiming work. No dynamic or paid model routers.
  let models: string[];
  try {
    models = configuredModels(env);
  } catch {
    return;
  }
  const client = supabase(env, { admin: true });
  const claimed = await client.rpc('claim_topic_content', {
    topic_input: topic.id,
    actor_input: actor,
    manual_input: manual,
  });
  if (claimed.error) throw new Error('Content claim failed');
  if (!claimed.data?.claimed) return;
  const job = claimed.data.jobId as string;
  let articles: Article[] = z.array(articleSchema).parse(claimed.data.news);
  const finish = async (
    status: string,
    error: string | null,
    summary: TopicData['summary'] = null,
    model: string | null = null,
    hash: string | null = null,
  ) => {
    const result = await client.rpc('finish_topic_content', {
      topic_input: topic.id,
      job_input: job,
      status_input: status,
      summary_input: summary,
      model_input: model,
      hash_input: hash,
      error_input: error,
    });
    if (result.error) throw new Error('Content save failed');
  };
  async function call<T>(
    provider: 'serper' | 'openrouter',
    run: () => Promise<T>,
    model: string | null = null,
  ): Promise<T> {
    const reservation = await client.rpc('reserve_provider_call', {
      provider_input: provider,
      topic_input: topic.id,
      job_input: job,
      model_input: model,
    });
    if (reservation.error) throw new ProviderFailure('reservation_failed');
    if (!reservation.data?.allowed)
      throw new ProviderFailure(
        `limit_${reservation.data?.reason ?? 'unknown'}`,
      );
    const id = reservation.data.id as string;
    try {
      const value = await run();
      const saved = await client.rpc('record_provider_result', {
        call_input: id,
        outcome_input: 'success',
      });
      if (saved.error) throw new ProviderFailure('accounting_failed');
      return value;
    } catch (error) {
      const failure =
        error instanceof ProviderFailure
          ? error
          : new ProviderFailure('provider_failed');
      const saved = await client.rpc('record_provider_result', {
        call_input: id,
        outcome_input: failure.code,
        cooldown_input: failure.cooldown,
      });
      // Never spend again when accounting is uncertain.
      if (saved.error) throw new ProviderFailure('accounting_failed');
      throw failure;
    }
  }
  try {
    // Saved news survives summary errors and is reused by an explicit retry.
    if (!articles.length && (!claimed.data.newsCheckedAt || manual)) {
      articles = await call('serper', () => fetchNews(env, topic.title));
      articles = await Promise.all(
        articles.map(async (article) => {
          const images = await resolveArticleImages(
            article.url,
            article.imageUrl,
          );
          // Keep provider images as the last option; the browser checks actual
          // decoding and resolution before displaying any candidate.
          return {
            ...article,
            imageUrl: images[0] ?? null,
            imageCandidates: images,
          };
        }),
      );
      const saved = await client.rpc('save_topic_news', {
        topic_input: topic.id,
        job_input: job,
        news_input: articles,
      });
      if (saved.error || !saved.data)
        throw new ProviderFailure('news_save_failed');
    }
    if (!articles.length) {
      await finish('empty', null);
      return;
    }
    const candidates = await checkFreeAvailability(env, models);
    const bytes = new TextEncoder().encode(JSON.stringify(articles));
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index]!;
      const model = candidate.id;
      try {
        if (index > 0) await checkFreeAvailability(env, [model]);
        const summary = await call(
          'openrouter',
          () =>
            fetchOverview(
              env,
              topic.title,
              articles,
              model,
              claimed.data.newsCheckedAt ?? new Date().toISOString(),
              candidate.reasoning,
            ),
          model,
        );
        await finish('ready', null, summary, model, hash);
        return;
      } catch (error) {
        if (
          !(error instanceof ProviderFailure) ||
          !error.fallback ||
          index === candidates.length - 1
        )
          throw error;
      }
    }
  } catch (error) {
    const failure =
      error instanceof ProviderFailure
        ? error
        : new ProviderFailure('preparation_failed');
    const paused =
      failure.cooldown ||
      failure.code.startsWith('limit_') ||
      failure.code === 'provider_reserve';
    await finish(
      paused ? 'paused' : articles.length ? 'partial' : 'error',
      failure.code,
    );
  }
}
