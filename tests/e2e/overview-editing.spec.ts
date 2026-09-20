import { expect, test } from '@playwright/test';
const id = 'ad000000-0000-4000-8000-000000000001';
const fixture = {
  id,
  title: 'Overview editing fixture',
  createdAt: '2026-09-20T10:00:00Z',
  newsRevision: 1,
  newsCheckedAt: null,
  summaryCheckedAt: '2026-09-20T10:00:00Z',
  contentStatus: 'ready',
  news: [],
  summary: {
    id,
    headline: 'Original headline',
    text: 'Original paragraph',
    paragraphs: [{ text: 'Original paragraph', sourceIds: ['one'] }],
    generatedAt: '2026-09-20T10:00:00Z',
    model: 'original-model:free',
    revision: 0,
    editedAt: null as string | null,
    sources: [
      {
        id: 'one',
        title: 'Original source',
        url: 'https://example.test/source',
        publisher: 'Publisher',
        publishedAt: null,
      },
    ],
  },
};
test('admin can cancel, retain a failed draft and save an attributed overview', async ({
  page,
}) => {
  let topic = structuredClone(fixture);
  let writes = 0;
  let fail = true;
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: true,
        user: {
          id,
          email: 'admin@example.test',
          isModerator: true,
          profile: {
            username: 'test_admin',
            avatar: null,
            createdAt: fixture.createdAt,
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${id}`, (r) => r.fulfill({ json: topic }));
  await page.route(`**/api/topics/${id}/overview`, async (r) => {
    writes++;
    if (fail)
      return r.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
      });
    const value = r.request().postDataJSON();
    topic = {
      ...topic,
      summary: {
        ...topic.summary,
        ...value,
        revision: 1,
        editedAt: '2026-09-20T12:00:00.000Z',
        text: value.paragraphs
          .map((p: { text: string }) => p.text)
          .join('\n\n'),
      },
    };
    await r.fulfill({ json: topic.summary });
  });
  await page.goto(`/topics/${id}`);
  const pencil = page.getByRole('button', {
    name: 'Edit overview',
    exact: true,
  });
  await expect(pencil).toBeVisible();
  expect(
    await pencil.evaluate((el) =>
      el.nextElementSibling?.classList.contains('topic-visit-count'),
    ),
  ).toBe(true);
  await pencil.click();
  await page
    .getByLabel('Overview title', { exact: true })
    .fill('Discarded edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Original headline' }),
  ).toBeVisible();
  expect(writes).toBe(0);
  await pencil.click();
  await page
    .getByLabel('Overview title', { exact: true })
    .fill('Edited headline');
  await page
    .getByLabel('Paragraph 1', { exact: true })
    .fill('Updated text <script>alert(1)</script>');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.overview-editor').getByRole('alert')).toHaveText(
    'Please try again.',
  );
  await expect(page.getByLabel('Overview title', { exact: true })).toHaveValue(
    'Edited headline',
  );
  fail = false;
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Edited headline' }),
  ).toBeVisible();
  await expect(page.locator('.overview-text')).toContainText(
    'Updated text <script>alert(1)</script>',
  );
  await expect(page.locator('.overview-text script')).toHaveCount(0);
  await expect(page.locator('.ai-credit')).toContainText('original-model:free');
  await expect(page.locator('.ai-credit')).toContainText('edit by admin');
  await expect(page.locator('.overview-citations')).toHaveCount(0);
  await expect(page.locator('.summary-sources a')).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Edited headline' }),
  ).toBeVisible();
  expect(writes).toBe(2);
});
test('public readers see attribution without editing controls', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: true, user: null } }),
  );
  await page.route(`**/api/topics/${id}`, (r) =>
    r.fulfill({
      json: {
        ...fixture,
        summary: {
          ...fixture.summary,
          editedAt: '2026-09-20T12:00:00.000Z',
          revision: 1,
        },
      },
    }),
  );
  await page.goto(`/topics/${id}`);
  await expect(page.locator('.ai-credit')).toContainText('edit by admin');
  await expect(
    page.getByRole('button', { name: 'Edit overview', exact: true }),
  ).toHaveCount(0);
});

test('moderation pencil opens the overview editor directly and cancel closes it', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: true,
        user: {
          id,
          email: 'admin@example.test',
          isModerator: true,
          profile: {
            username: 'test_admin',
            avatar: null,
            createdAt: fixture.createdAt,
          },
        },
      },
    }),
  );
  await page.route('**/api/moderation/topics?*', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            id,
            topicId: id,
            title: fixture.title,
            body: null,
            createdAt: fixture.createdAt,
          },
        ],
        hasMore: false,
      },
    }),
  );
  await page.route('**/api/moderation/budget', (r) =>
    r.fulfill({ json: { enabled: false, providers: [] } }),
  );
  await page.route(`**/api/topics/${id}`, (r) => r.fulfill({ json: fixture }));
  await page.goto('/moderation');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page
    .getByRole('link', { name: `Edit overview: ${fixture.title}` })
    .click();
  await expect(page.getByLabel('Overview title', { exact: true })).toHaveValue(
    fixture.summary.headline,
  );
  await expect(page.getByLabel('Paragraph 1', { exact: true })).toHaveValue(
    'Original paragraph',
  );
  await expect(page).toHaveURL(new RegExp(`/topics/${id}$`));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: fixture.summary.headline }),
  ).toBeVisible();
  await expect(page.getByLabel('Overview title', { exact: true })).toHaveCount(
    0,
  );
});

test('a public edit URL never opens admin fields', async ({ page }) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: true, user: null } }),
  );
  await page.route(`**/api/topics/${id}`, (r) => r.fulfill({ json: fixture }));
  await page.goto(`/topics/${id}?edit=overview`);
  await expect(
    page.getByRole('heading', { name: fixture.summary.headline }),
  ).toBeVisible();
  await expect(page.getByLabel('Overview title', { exact: true })).toHaveCount(
    0,
  );
});

test('topic header reading progress follows scroll and disappears on other pages', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: true, user: null } }),
  );
  await page.route('**/api/home', (r) =>
    r.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
  const longTopic = {
    ...fixture,
    summary: {
      ...fixture.summary,
      paragraphs: Array.from({ length: 12 }, () => ({
        text: 'A long passage for reading. '.repeat(20),
        sourceIds: ['one'],
      })),
    },
  };
  await page.route(`**/api/topics/${id}`, (r) =>
    r.fulfill({ json: longTopic }),
  );
  await page.goto(`/topics/${id}`);
  const progress = page.getByRole('progressbar', {
    name: 'Page reading progress',
  });
  await expect(
    page.getByRole('heading', { name: fixture.summary.headline }),
  ).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.evaluate(() =>
    window.scrollTo({
      top: (document.documentElement.scrollHeight - innerHeight) / 2,
      behavior: 'instant',
    }),
  );
  await expect(progress).toHaveAttribute('aria-valuenow', '50');
  // Reading progress follows scroll immediately; header compaction finishes
  // independently even when the reader stops scrolling here.
  await expect
    .poll(async () => {
      const box = await progress.boundingBox();
      return box ? box.y + box.height : Infinity;
    })
    .toBeLessThan(100);
  const fill = await progress.locator('span').boundingBox();
  const track = await progress.boundingBox();
  expect(fill!.width / track!.width).toBeCloseTo(0.5, 1);
  expect(track!.y).toBeGreaterThan(0);
  expect(track!.y + track!.height).toBeLessThan(100);
  await page.evaluate(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'instant',
    }),
  );
  await expect(progress).toHaveAttribute('aria-valuenow', '100');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(progress).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('link', { name: 'All topics', exact: true }).click();
  await expect(progress).toHaveCount(0);
  await page.goto('/mission/');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});
