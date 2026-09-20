import { expect, test } from '@playwright/test';
const id = 'ae000000-0000-4000-8000-000000000001';
const source = {
  id: 'source-one',
  title: 'A mission to map the Moon',
  url: 'https://example.test/report',
  publisher: 'Space Journal',
  publishedAt: null,
};
const topic = {
  id,
  title: 'Space exploration',
  createdAt: '2026-09-20T10:00:00Z',
  news: [source],
  newsCheckedAt: '2026-09-20T10:01:00Z',
  newsRevision: 1,
  summary: null,
  summaryCheckedAt: null,
  contentStatus: 'partial',
  contentRetryAt: null,
};
const ready = {
  ...topic,
  contentStatus: 'ready',
  summaryCheckedAt: '2026-09-20T10:02:00Z',
  summary: {
    id: 'ae000000-0000-4000-8000-000000000002',
    headline: 'A closer look at the lunar surface',
    text: 'Saved source-based overview.',
    generatedAt: '2026-09-20T10:02:00Z',
    sources: [source],
    paragraphs: [
      {
        text: 'The agency announced a new mission to study the Moon, according to the available reporting. [1, 2] [3]',
        sourceIds: [source.id],
      },
      {
        text: 'Details remain limited. The supplied excerpt does not specify the mission’s schedule.',
        sourceIds: [source.id],
      },
    ],
  },
};
test('news shows each publisher icon and keeps its size when an icon fails', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: true, localSignup: false },
    }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...ready,
        news: [
          {
            ...source,
            url: 'https://space.example.test/report?private=article',
          },
          {
            ...source,
            id: 'two',
            url: 'https://science.example.test/news',
            publisher: 'Science Today',
          },
          {
            ...source,
            id: 'three',
            url: 'https://failed.example.test/news',
            publisher: 'Failed Icon',
          },
        ],
      },
    }),
  );
  const domains: string[] = [];
  await page.route('https://www.google.com/s2/favicons?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const domain = params.get('domain')!;
    domains.push(domain);
    expect(params.get('sz')).toBe('32');
    if (domain === 'failed.example.test') return route.abort();
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="purple"/></svg>',
    });
  });
  await page.goto(`/topics/${id}`);
  await page.locator('.topic-news').scrollIntoViewIfNeeded();
  const icons = page.locator('.article-meta .publisher-icon');
  await expect(icons).toHaveCount(3);
  await expect(page.locator('.publisher-initial')).toHaveText('F');
  await expect.poll(() => domains.length).toBe(3);
  expect(domains.sort()).toEqual([
    'failed.example.test',
    'science.example.test',
    'space.example.test',
  ]);
  for (const icon of await icons.all()) {
    await expect(icon).toHaveCSS('width', '16px');
    await expect(icon).toHaveCSS('height', '16px');
  }
  const loaded = page.locator('.publisher-icon img');
  await expect(loaded).toHaveCount(2);
  await expect
    .poll(() =>
      loaded.evaluateAll((images) =>
        images.every((img) => (img as HTMLImageElement).naturalWidth === 32),
      ),
    )
    .toBe(true);
  await expect(page.locator('.article-meta')).toHaveText([
    'Space Journal',
    'Science Today',
    'FFailed Icon',
  ]);
});

test('retry preserves sources without inline citations or regeneration on reload', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        available: true,
        localSignup: true,
        user: {
          id: 'ae000000-0000-4000-8000-000000000003',
          email: 'reader@example.test',
          profile: {
            username: 'test_reader',
            avatar: null,
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${id}/permissions`, (route) =>
    route.fulfill({ json: { canDelete: true } }),
  );
  let prepared = false;
  let calls = 0;
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({ json: prepared ? ready : topic }),
  );
  await page.route(`**/api/topics/${id}/prepare`, (route) => {
    calls++;
    prepared = true;
    return route.fulfill({ json: ready });
  });
  await page.goto(`/topics/${id}`);
  await expect(
    page.getByRole('link', { name: source.title, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry preparation' }).click();
  await expect(
    page.getByRole('heading', { name: ready.summary.headline }),
  ).toBeVisible();
  await expect(page.locator('.overview-text')).not.toContainText('[1');
  await expect(page.locator('.overview-citations')).toHaveCount(0);
  await page.locator('.summary-sources summary').click();
  await expect(page.locator('.summary-sources a')).toHaveAttribute(
    'href',
    source.url,
  );
  await expect(
    page.getByRole('button', { name: 'Retry preparation' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: ready.summary.headline }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test('quota pauses retain articles and never automatically retry providers', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { user: null, available: true, localSignup: true } }),
  );
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/topics'))
      writes++;
  });
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...topic,
        contentStatus: 'paused',
        contentRetryAt: '2099-09-21T00:00:00Z',
      },
    }),
  );
  await page.goto(`/topics/${id}`);
  await expect(
    page.getByText('The AI overview is temporarily unavailable.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: source.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry preparation' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('link', { name: source.title, exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
});

test('topic loading reserves the card position and late or failed images do not move headlines', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: true, localSignup: false },
    }),
  );
  let releaseTopic!: () => void;
  const topicGate = new Promise<void>((resolve) => {
    releaseTopic = resolve;
  });
  let releaseImage!: () => void;
  const imageGate = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  await page.route(`**/api/topics/${id}`, async (route) => {
    await topicGate;
    await route.fulfill({
      json: {
        ...ready,
        news: [{ ...source, imageUrl: 'https://example.test/late.jpg' }],
      },
    });
  });
  await page.route('https://example.test/late.jpg', async (route) => {
    await imageGate;
    await route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`/topics/${id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topic-placeholder-card')).toBeVisible();
  const initial = await page.locator('.topic-placeholder-card').boundingBox();
  releaseTopic();
  await expect(
    page.getByRole('heading', { name: ready.summary.headline }),
  ).toBeVisible();
  const loaded = await page.locator('.topic-card').first().boundingBox();
  expect(Math.abs(initial!.y - loaded!.y)).toBeLessThan(10);
  await page.locator('.news-story--lead').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator('.topic-news')
        .evaluate(
          (el) =>
            el.getAnimations().filter((a) => a.playState === 'running').length,
        ),
    )
    .toBe(0);
  const before = await page.locator('.news-story--lead h3').boundingBox();
  releaseImage();
  await expect(page.locator('.news-image')).toHaveCount(0);
  await expect(page.locator('.news-image-frame')).toBeVisible();
  const after = await page.locator('.news-story--lead h3').boundingBox();
  expect(Math.abs(before!.y - after!.y)).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.topic-news')
      .evaluate((el) => el.getAnimations().length),
  ).toBe(0);
});

test('an expired cooldown reveals the manual retry without making a request', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        available: true,
        localSignup: true,
        user: {
          id: 'ae000000-0000-4000-8000-000000000003',
          email: 'reader@example.test',
          profile: {
            username: 'test_reader',
            avatar: null,
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${id}/permissions`, (route) =>
    route.fulfill({ json: { canDelete: true } }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...topic,
        contentStatus: 'paused',
        contentRetryAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  );
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/prepare'))
      writes++;
  });
  await page.goto(`/topics/${id}`);
  await expect(
    page.getByText('Preparation can be retried after', { exact: false }),
  ).toBeVisible();
  await page.clock.fastForward(61000);
  await expect(
    page.getByRole('button', { name: 'Retry preparation' }),
  ).toBeVisible();
  expect(writes).toBe(0);
});

for (const format of ['png', 'jpeg', 'webp', 'avif', 'gif', 'svg']) {
  test(`news accepts ${format} content from extensionless CDN URLs`, async ({
    page,
  }) => {
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: { user: null, available: true, localSignup: false },
      }),
    );
    await page.route(`**/api/topics/${id}`, (route) =>
      route.fulfill({
        json: {
          ...ready,
          news: [
            {
              ...source,
              imageUrl: `https://cdn.example.test/asset?format=${format}&signature=keep`,
            },
          ],
        },
      }),
    );
    await page.route('https://cdn.example.test/asset?*', (route) =>
      format === 'svg'
        ? route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="purple"/></svg>',
          })
        : route.fulfill({
            contentType: `image/${format}`,
            path: `tests/fixtures/news-images/photo.${format}`,
          }),
    );
    await page.goto(`/topics/${id}`);
    const image = page.locator('.news-image');
    await expect(image).toBeVisible();
    expect(
      await image.evaluate((el) => (el as HTMLImageElement).naturalWidth),
    ).toBe(960);
  });
}

test('news skips broken and undersized candidates without revealing a thumbnail', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: true, localSignup: false },
    }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...ready,
        news: [
          {
            ...source,
            imageUrl: 'https://cdn.example.test/broken',
            imageCandidates: [
              'https://cdn.example.test/broken',
              'https://cdn.example.test/small',
              'https://cdn.example.test/original',
            ],
          },
        ],
      },
    }),
  );
  await page.route('https://cdn.example.test/broken', (route) =>
    route.fulfill({ status: 403, body: '' }),
  );
  await page.route('https://cdn.example.test/small', (route) =>
    route.fulfill({
      contentType: 'image/png',
      path: 'tests/fixtures/news-images/thumbnail.png',
    }),
  );
  await page.route('https://cdn.example.test/original', (route) =>
    route.fulfill({
      contentType: 'image/webp',
      path: 'tests/fixtures/news-images/photo.webp',
    }),
  );
  await page.goto(`/topics/${id}`);
  await expect(page.locator('.news-image')).toBeVisible();
  await expect(page.locator('.news-image')).toHaveAttribute(
    'src',
    'https://cdn.example.test/original',
  );
});

test('news promotes the matching article when the first publisher has no usable photo', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: true, localSignup: false },
    }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...ready,
        news: [
          { ...source, imageUrl: 'https://cdn.example.test/broken' },
          {
            ...source,
            id: 'another',
            title: 'Another report with its own photograph',
            url: 'https://second.example.test/report',
            imageCandidates: ['https://cdn.example.test/original'],
          },
        ],
      },
    }),
  );
  await page.route('https://cdn.example.test/broken', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.route('https://cdn.example.test/original', (route) =>
    route.fulfill({
      contentType: 'image/jpeg',
      path: 'tests/fixtures/news-images/photo.jpeg',
    }),
  );
  await page.goto(`/topics/${id}`);
  await expect(page.locator('.news-image')).toBeVisible();
  await expect(page.locator('.news-story--lead h3')).toHaveText(
    'Another report with its own photograph',
  );
  await expect(page.locator('.news-secondary h3')).toHaveText(source.title);
});
