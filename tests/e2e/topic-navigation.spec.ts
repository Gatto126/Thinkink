import { expect, test } from '@playwright/test';
const id = 'ac000000-0000-4000-8000-000000000001';
const topic = {
  id,
  title: 'Topic navigation fixture',
  createdAt: '2026-09-20T10:00:00Z',
  newsRevision: 1,
  newsCheckedAt: '2026-09-20T16:25:00Z',
  summaryCheckedAt: '2026-09-20T16:26:00Z',
  contentStatus: 'ready',
  summary: {
    id,
    headline: 'A saved overview with original sources',
    text: 'This saved overview remains visible when returning to the topic.',
    generatedAt: '2026-09-20T16:26:00Z',
    model: 'nex-agi/nex-n2.5-mini:free',
    sources: [],
  },
  news: [
    {
      id: 'one',
      title: 'First article',
      url: 'https://example.test/one',
      publisher: 'First publisher',
      publishedAt: '2026-09-20T14:25:00Z',
      publishedAtEstimated: true,
      imageUrl: 'https://example.test/image.svg',
    },
    {
      id: 'two',
      title: 'Second article',
      url: 'https://example.test/two',
      publisher: 'Second publisher',
      publishedAt: '2026-09-20T12:00:00Z',
    },
  ],
};
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: true, user: null } }),
  );
  await page.route('**/api/home', (r) =>
    r.fulfill({
      json: {
        latest: [{ id, title: topic.title, createdAt: topic.createdAt }],
        mostVisited: [],
      },
    }),
  );
  await page.route('https://example.test/image.svg', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="gray"/></svg>',
    }),
  );
});
test('returning through Home and Mission keeps cached topic content visible during slow revalidation', async ({
  page,
}) => {
  let hold = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/topics/${id}`, async (r) => {
    if (hold) await gate;
    await r.fulfill({ json: topic });
  });
  await page.goto('/');
  await page.getByRole('link', { name: topic.title, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: topic.summary.headline }),
  ).toBeVisible();
  await expect(page.locator('.article-date time')).toHaveCount(2);
  await expect(page.locator('.article-date').first()).toContainText('≈');
  await expect(page.locator('.ai-credit')).toContainText(topic.summary.model);
  await expect(page.locator('.overview-note')).toHaveCount(0);
  await page.getByRole('link', { name: 'All topics', exact: true }).click();
  await expect(
    page.getByRole('link', { name: topic.title, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.list-skeleton')).toHaveCount(0);
  await page.getByRole('link', { name: 'Mission', exact: true }).click();
  await page.getByRole('link', { name: 'Explore', exact: true }).click();
  hold = true;
  await page.getByRole('link', { name: topic.title, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: topic.summary.headline }),
  ).toBeVisible();
  await expect(page.locator('.topic-placeholder-card')).toHaveCount(0);
  for (const selector of ['.topic-overview', '.topic-news', '.news-image']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1');
    expect(
      await page.locator(selector).evaluate((el) => el.getAnimations().length),
    ).toBe(0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { name: topic.summary.headline }),
  ).toBeVisible();
  await expect(page.locator('.topic-placeholder-card')).toHaveCount(0);
  release();
});
test('a deleted cached topic is removed after the authoritative 404', async ({
  page,
}) => {
  let deleted = false;
  await page.route(`**/api/topics/${id}`, (r) =>
    r.fulfill(
      deleted
        ? {
            status: 404,
            json: {
              error: {
                code: 'TOPIC_NOT_FOUND',
                message: 'This topic could not be found.',
              },
            },
          }
        : { json: topic },
    ),
  );
  await page.goto(`/topics/${id}`);
  await expect(
    page.getByRole('heading', { name: topic.summary.headline }),
  ).toBeVisible();
  deleted = true;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('could not be found');
  expect(
    await page.evaluate(
      (id) => sessionStorage.getItem('thinkink:content:v1:topic:' + id),
      id,
    ),
  ).toBeNull();
});
