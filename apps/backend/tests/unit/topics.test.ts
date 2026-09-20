import { describe, expect, it, vi } from 'vitest';
import { handleTopics } from '../../src/topics/routes';
import {
  homeSchema,
  topicSchema,
  topicTitleSchema,
  topicSuggestionsSchema,
} from '@thinkink/shared/contracts';

const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test',
};
const request = (path: string, init?: RequestInit) =>
  new Request(`http://127.0.0.1:4173${path}`, init);

describe('catalogue boundaries', () => {
  it('does not create through GET, foreign origins or anonymous sessions', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await handleTopics(request('/api/topics'), env)).status).toBe(405);
    expect(
      (
        await handleTopics(
          request('/api/topics', {
            method: 'POST',
            headers: { Origin: 'https://other.example' },
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleTopics(
          request('/api/topics', {
            method: 'POST',
            headers: { Origin: 'http://127.0.0.1:4173' },
          }),
          env,
        )
      ).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('validates lookups before contacting the database', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(
      (await handleTopics(request('/api/topics/resolve?q=x'), env)).status,
    ).toBe(400);
    expect(
      (await handleTopics(request('/api/topics/not-a-uuid'), env)).status,
    ).toBe(404);
    expect(
      (await handleTopics(request('/api/topics/search?q=x'), env)).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports unavailable configuration without inventing content', async () => {
    const result = await handleTopics(request('/api/home'), {});
    expect(result.status).toBe(503);
    expect(await result.json()).toHaveProperty(
      'error.code',
      'CATALOG_UNAVAILABLE',
    );
  });
  it('returns contract-valid UTC dates from Postgres offset timestamps', async () => {
    const row = {
      id: 'cda32e79-7079-49f1-a423-d506f93472f8',
      title: 'Ocean policy',
      created_at: '2026-09-20T12:00:00.123456+00:00',
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      Response.json(
        String(url).includes('/rpc/popular_topics')
          ? []
          : String(url).includes('/rpc/topic_activity')
            ? [{ topic_id: row.id, visits: 12, comment_count: 3 }]
            : [row],
      ),
    );
    const home = await handleTopics(request('/api/home'), env);
    const data = homeSchema.parse(await home.json());
    expect(data.latest[0]?.createdAt).toBe('2026-09-20T12:00:00.123Z');
    expect(data.mostVisited).toEqual([]);
    expect(data.latest[0]).toMatchObject({ visits: 12, commentCount: 3 });
    const resolved = await handleTopics(
      request('/api/topics/resolve?q=Ocean%20policy'),
      env,
    );
    expect(topicSchema.parse(await resolved.json())).toMatchObject({
      id: row.id,
      createdAt: data.latest[0]?.createdAt,
      summary: null,
      news: [],
    });
  });
  it('returns bounded public suggestions with UTC dates', async () => {
    const row = {
      id: 'cda32e79-7079-49f1-a423-d506f93472f8',
      title: 'War in Iran',
      created_at: '2026-09-20T12:00:00+00:00',
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([row]));
    const response = await handleTopics(
      request('/api/topics/search?q=iran'),
      env,
    );
    expect(response.status).toBe(200);
    expect(topicSuggestionsSchema.parse(await response.json()).topics).toEqual([
      { id: row.id, title: row.title, createdAt: '2026-09-20T12:00:00.000Z' },
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/rpc/search_topics');
  });
  it('normalizes compatibility characters and whitespace without changing display case', () => {
    expect(topicTitleSchema.parse('  Ｏｃｅａｎ\t policy  ')).toBe(
      'Ocean policy',
    );
    expect(topicTitleSchema.safeParse(' '.repeat(10)).success).toBe(false);
  });
});
