import { describe, it, expect, vi } from 'vitest';
import { publicationDate } from '../../src/content/publication';
import { readContent } from '../../src/content/service';
import { topicSchema } from '@thinkink/shared/contracts';

describe('public content attribution', () => {
  it('anchors estimated publication dates to retrieval, not viewing time', () => {
    expect(publicationDate('2 hours ago', '2026-09-20T16:25:00Z')).toEqual({
      publishedAt: '2026-09-20T14:25:00.000Z',
      publishedAtEstimated: true,
      publishedDateLabel: '2 hours ago',
    });
    expect(
      publicationDate('1 day ago', '2026-09-20T16:25:00Z').publishedAt,
    ).toBe('2026-09-19T16:25:00.000Z');
    expect(
      publicationDate('Sep 19, 2026', '2026-09-20T16:25:00Z'),
    ).toMatchObject({ publishedAt: null, publishedDateLabel: 'Sep 19, 2026' });
    expect(publicationDate('2 hours ago', null).publishedAt).toBeNull();
    expect(
      publicationDate(null, '2026-09-20T16:25:00Z').publishedAt,
    ).toBeNull();
  });
  it('exposes the saved generating model and dates without invoking providers', async () => {
    const row = {
      id: 'a1000000-0000-4000-8000-000000000001',
      title: 'Example topic',
      summary: null,
      summaryCheckedAt: null,
      news: [],
      newsCheckedAt: null,
      newsRevision: 0,
    };
    const news = {
      id: 'source',
      title: 'Headline',
      url: 'https://example.com/news',
      publisher: 'Publisher',
      publishedAt: null,
      dateLabel: '3 hours ago',
      snippet: 'Private input',
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        news: [news],
        news_checked_at: '2026-09-20T16:25:00Z',
        news_revision: 1,
        status: 'ready',
        model: 'saved/model:free',
        summary: {
          id: row.id,
          text: 'Overview',
          generatedAt: '2026-09-20T16:26:00Z',
          sources: [],
        },
      }),
    );
    const result = await readContent(
      {
        SUPABASE_URL: 'https://database.example',
        SUPABASE_PUBLISHABLE_KEY: 'public',
      },
      topicSchema.parse(row),
    );
    expect(result.summary?.model).toBe('saved/model:free');
    expect(result.news[0]).toMatchObject({
      publishedAt: '2026-09-20T13:25:00.000Z',
      publishedAtEstimated: true,
    });
    expect(result.news[0]).not.toHaveProperty('snippet');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
