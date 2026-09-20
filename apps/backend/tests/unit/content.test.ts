import { describe, expect, it, vi } from 'vitest';
import { topicSchema } from '@thinkink/shared/contracts';
import {
  configuredModels,
  parseNews,
  parseOverview,
  publicUrl,
} from '../../src/content/providers';
import {
  prepareContent,
  providersEnabled,
  readContent,
} from '../../src/content/service';

const model = 'google/gemma-4-31b-it:free';
const fallback = 'nvidia/nemotron-3-super-120b-a12b:free';
const env = {
  SUPABASE_URL: 'https://database.example',
  SUPABASE_PUBLISHABLE_KEY: 'public-test',
  SUPABASE_SECRET_KEY: 'secret-test',
  CONTENT_PROVIDERS_ENABLED: 'true',
  SERPER_API_KEY: 'serper-test',
  OPENROUTER_API_KEY: 'router-test',
  OPENROUTER_MODEL: model,
  OPENROUTER_FALLBACK_MODEL: fallback,
};
const topic = topicSchema.parse({
  id: 'af000000-0000-4000-8000-000000000001',
  title: 'Space exploration',
  summary: null,
  summaryCheckedAt: null,
  news: [],
  newsCheckedAt: null,
  newsRevision: 0,
});
const rawNews = {
  news: [
    {
      title: 'A new mission studies the Moon',
      link: 'https://news.example/story?utm_source=tracking',
      source: 'Space Journal',
      snippet: 'The agency announced a mission to study lunar terrain.',
      date: '2 hours ago',
      imageUrl: 'https://images.example/moon.jpg',
    },
  ],
};
const overview = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          headline: 'A new mission will study lunar terrain',
          paragraphs: [
            {
              text: 'Space Journal reports that the agency has announced a mission focused on studying lunar terrain.',
              sources: [1],
            },
            {
              text: 'The supplied report gives limited detail about the mission. Its schedule and instruments are not specified in the excerpt.',
              sources: [1],
            },
          ],
        }),
      },
    },
  ],
};

function mockPipeline(
  options: {
    publisherImages?: boolean;
    denied?: boolean;
    primary?: number;
    upstream?: boolean;
    platformHeaders?: boolean;
    remaining?: number;
    reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
    savedNews?: boolean;
    unclaimed?: boolean;
  } = {},
) {
  const articles = parseNews(rawNews);
  const requests: {
    url: string;
    body: Record<string, unknown>;
    redirect?: RequestInit['redirect'];
  }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    requests.push({ url, body, redirect: init?.redirect });
    if (url.startsWith('https://cloudflare-dns.com/'))
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: '93.184.215.14' }],
      });
    if (url.includes('/rpc/claim_topic_content'))
      return Response.json({
        claimed: !options.unclaimed,
        jobId: 'job-test',
        news: options.savedNews ? articles : [],
        newsCheckedAt: options.savedNews ? '2026-09-20T10:00:00Z' : null,
      });
    if (url.includes('/rpc/reserve_provider_call'))
      return Response.json({
        allowed: !options.denied,
        reason: 'budget',
        id: 'attempt-test',
      });
    if (url.includes('/rpc/')) return Response.json(true);
    if (url === 'https://google.serper.dev/news')
      return Response.json(
        options.publisherImages
          ? {
              news: [
                {
                  ...rawNews.news[0],
                  link: 'https://www.space.com/space-exploration/story',
                  imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tiny',
                },
              ],
            }
          : rawNews,
      );
    if (url === 'https://www.space.com/space-exploration/story')
      return new Response(
        '<meta property="og:image" content="https://cdn.mos.cms.futurecdn.net/test-1936-80.jpg">',
        { headers: { 'Content-Type': 'text/html' } },
      );
    if (url.endsWith('/api/v1/key'))
      return Response.json({
        data: {
          free_model_daily_requests: { remaining: options.remaining ?? 50 },
        },
      });
    if (url.endsWith('/api/v1/models'))
      return Response.json({
        data: [model, fallback].map((id) => ({
          id,
          pricing: { prompt: '0', completion: '0' },
          reasoning: options.reasoning,
        })),
      });
    if (url.endsWith('/chat/completions')) {
      if (body.model === model && options.primary)
        return Response.json(
          {
            error: options.upstream
              ? {
                  metadata: {
                    provider_name: 'Test upstream',
                    provider_code: 429,
                  },
                }
              : 'unavailable',
          },
          {
            status: options.primary,
            headers: options.platformHeaders
              ? { 'X-RateLimit-Remaining': '0' }
              : {},
          },
        );
      return Response.json(overview);
    }
    if (url.includes('/rest/v1/topic_content')) return Response.json(null);
    throw new Error(`Unexpected test request: ${url}`);
  });
  return requests;
}
describe('provider boundaries and durable preparation', () => {
  it('fails closed for disabled environments, tests, or non-free models', async () => {
    expect(providersEnabled({ ...env, AUTOMATED_TEST_MODE: 'true' })).toBe(
      false,
    );
    expect(
      providersEnabled({ ...env, CONTENT_PROVIDERS_ENABLED: 'false' }),
    ).toBe(false);
    expect(() =>
      configuredModels({ ...env, OPENROUTER_MODEL: 'openrouter/auto' }),
    ).toThrow('free_model_required');
    expect(() =>
      configuredModels({ ...env, OPENROUTER_FALLBACK_MODEL: 'paid/model' }),
    ).toThrow('free_model_required');
    const fetch = vi.spyOn(globalThis, 'fetch');
    await prepareContent(
      { ...env, AUTOMATED_TEST_MODE: 'true' },
      topic,
      'actor',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('normalizes links and rejects unsafe, duplicate or unusable results', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://localhost/a',
      'https://127.0.0.1/a',
      'http://169.254.169.254/a',
      'https://user:password@example.com/a',
    ])
      expect(publicUrl(url)).toBeNull();
    const news = parseNews({
      news: [
        ...rawNews.news,
        ...rawNews.news,
        { title: 'Unsafe', link: 'javascript:alert(1)' },
      ],
    });
    expect(news).toHaveLength(1);
    expect(news[0]?.url).toBe('https://news.example/story');
    expect(news[0]?.publishedAt).toBeNull();
    expect(news[0]?.dateLabel).toBe('2 hours ago');
  });
  it('requires structured, complete output and only supplied source references', () => {
    const articles = parseNews(rawNews);
    expect(
      parseOverview(overview, articles).paragraphs?.[0]?.sourceIds,
    ).toEqual([articles[0]?.id]);
    expect(() =>
      parseOverview(
        { choices: [{ ...overview.choices[0], finish_reason: 'length' }] },
        articles,
      ),
    ).toThrow('incomplete_overview');
    const marked = structuredClone(overview);
    const payload = JSON.parse(marked.choices[0]!.message.content);
    payload.paragraphs[0].text =
      'Reported growth of 15% [1, 2]. More context [1][2–3] remains [uncertain].';
    marked.choices[0]!.message.content = JSON.stringify(payload);
    const clean = parseOverview(marked, articles);
    expect(clean.paragraphs?.[0]?.text).toBe(
      'Reported growth of 15%. More context remains [uncertain].',
    );
    expect(clean.paragraphs?.[0]?.sourceIds).toEqual([articles[0]?.id]);
    expect(clean.text).not.toContain('[1');
    const invalid = structuredClone(overview);
    invalid.choices[0]!.message.content =
      invalid.choices[0]!.message.content.replaceAll('[1]', '[6]');
    expect(() => parseOverview(invalid, articles)).toThrow('invalid_citations');
  });
  it('recognizes provider errors inside HTTP 200 and does not accept truncated or filtered content', () => {
    const articles = parseNews(rawNews);
    expect(() => parseOverview({ error: { code: 429 } }, articles)).toThrow(
      'http_429',
    );
    expect(() => parseOverview({ choices: [] }, articles)).toThrow(
      'invalid_overview_envelope',
    );
    expect(() =>
      parseOverview(
        {
          choices: [
            { ...overview.choices[0], finish_reason: 'content_filter' },
          ],
        },
        articles,
      ),
    ).toThrow('overview_filtered');
  });
  it('prepares once with zero price caps and saves immutable citations', async () => {
    const requests = mockPipeline();
    await prepareContent(env, topic, 'actor');
    expect(
      requests.filter((row) => row.url === 'https://google.serper.dev/news'),
    ).toHaveLength(1);
    const ai = requests.filter((row) => row.url.endsWith('/chat/completions'));
    expect(ai).toHaveLength(1);
    expect(ai[0]?.redirect).toBe('manual');
    expect(ai[0]?.body).toMatchObject({
      model,
      max_tokens: 1200,
      stream: false,
      provider: {
        allow_fallbacks: false,
        max_price: { prompt: 0, completion: 0, request: 0 },
      },
    });
    expect(requests.at(-1)?.body).toMatchObject({
      status_input: 'ready',
      model_input: model,
      summary_input: {
        sources: [
          expect.objectContaining({ url: 'https://news.example/story' }),
        ],
      },
    });
  });
  it('never calls providers when a budget reservation is denied or another job owns the claim', async () => {
    const requests = mockPipeline({ denied: true });
    await prepareContent(env, topic, 'actor');
    expect(
      requests.filter(
        (row) =>
          row.url.includes('serper.dev') || row.url.includes('openrouter.ai'),
      ),
    ).toHaveLength(0);
    expect(requests.at(-1)?.body).toMatchObject({ status_input: 'paused' });
    const other = mockPipeline({ unclaimed: true });
    await prepareContent(env, topic, 'actor');
    expect(other).toHaveLength(1);
  });
  it('reuses persisted news on explicit retries', async () => {
    const requests = mockPipeline({ savedNews: true });
    await prepareContent(env, topic, 'actor', true);
    expect(requests.some((row) => row.url.includes('serper.dev'))).toBe(false);
    const ai = requests.find((row) => row.url.endsWith('/chat/completions'));
    expect(JSON.stringify(ai?.body.messages)).toContain('2026-09-20T10:00:00Z');
  });
  it('allows one free fallback on server failure but never retries quota errors', async () => {
    const failure = mockPipeline({ primary: 503 });
    await prepareContent(env, topic, 'actor');
    expect(
      failure
        .filter((row) => row.url.endsWith('/chat/completions'))
        .map((row) => row.body.model),
    ).toEqual([model, fallback]);
    const quota = mockPipeline({ primary: 429 });
    await prepareContent(env, topic, 'actor');
    expect(
      quota.filter((row) => row.url.endsWith('/chat/completions')),
    ).toHaveLength(1);
    expect(
      quota.find((row) => row.body.cooldown_input === true)?.body,
    ).toMatchObject({ outcome_input: 'http_429' });
    expect(quota.at(-1)?.body).toMatchObject({ status_input: 'paused' });
  });
  it('reading content never contacts either provider', async () => {
    const requests = mockPipeline();
    await readContent(env, topic);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('/rest/v1/topic_content');
  });
  it('allows only one upstream-capacity fallback, rechecks free quota, and respects platform headers', async () => {
    const upstream = mockPipeline({ primary: 429, upstream: true });
    await prepareContent(env, topic, 'actor');
    expect(
      upstream.filter((row) => row.url.endsWith('/chat/completions')),
    ).toHaveLength(2);
    expect(
      upstream.filter((row) => row.url.endsWith('/api/v1/key')),
    ).toHaveLength(2);
    expect(upstream.at(-1)?.body.status_input).toBe('ready');
    const platform = mockPipeline({
      primary: 429,
      upstream: true,
      platformHeaders: true,
    });
    await prepareContent(env, topic, 'actor');
    expect(
      platform.filter((row) => row.url.endsWith('/chat/completions')),
    ).toHaveLength(1);
    expect(platform.at(-1)?.body.status_input).toBe('paused');
  });
  it('preserves the final ten free requests without attempting inference', async () => {
    const requests = mockPipeline({ savedNews: true, remaining: 10 });
    await prepareContent(env, topic, 'actor', true);
    expect(requests.some((row) => row.url.endsWith('/chat/completions'))).toBe(
      false,
    );
    expect(requests.at(-1)?.body).toMatchObject({
      status_input: 'paused',
      error_input: 'provider_reserve',
    });
  });
  it('disables reasoning with supported effort settings and excludes mandatory reasoning models', async () => {
    const disabled = mockPipeline({
      reasoning: { mandatory: false, supported_efforts: ['medium', 'none'] },
    });
    await prepareContent(env, topic, 'actor');
    expect(
      disabled.find((row) => row.url.endsWith('/chat/completions'))?.body
        .reasoning,
    ).toEqual({ enabled: false, exclude: true, effort: 'none' });
    const mandatory = mockPipeline({
      savedNews: true,
      reasoning: { mandatory: true },
    });
    await prepareContent(env, topic, 'actor', true);
    expect(mandatory.some((row) => row.url.endsWith('/chat/completions'))).toBe(
      false,
    );
    expect(mandatory.at(-1)?.body.error_input).toBe('free_model_unavailable');
  });
});

it('drops search thumbnails before news persistence but keeps original image URLs', () => {
  for (const imageUrl of [
    'https://encrypted-tbn0.gstatic.com/images?q=tbn:tiny',
    'https://tbn1.google.com/images?q=tbn:tiny',
  ]) {
    expect(
      parseNews({ news: [{ ...rawNews.news[0], imageUrl }] })[0]?.imageUrl,
    ).toBeNull();
  }
  expect(parseNews(rawNews)[0]?.imageUrl).toBe(
    'https://images.example/moon.jpg',
  );
});

it('saves the original lead photo during initial topic preparation', async () => {
  const requests = mockPipeline({ publisherImages: true });
  await prepareContent(env, topic, 'actor');
  const saved = requests.find((r) => r.url.includes('/rpc/save_topic_news'));
  expect(saved?.body.news_input).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        imageUrl: 'https://cdn.mos.cms.futurecdn.net/test-1936-80.jpg',
      }),
    ]),
  );
});
