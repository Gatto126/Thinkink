import { expect, test } from '@playwright/test';

// Controlled content belongs only to this test, never to the live catalogue.
const id = 'cda32e79-7079-49f1-a423-d506f93472f8';
const topic = {
  id,
  title: 'A changing city',
  createdAt: '2026-09-20T10:00:00Z',
  summary: {
    id: 'a9d5174b-9093-4da4-a4be-29f6a795055d',
    text: 'The city’s transport plans have opened a wider conversation about how people move, meet and share their streets. Local reporting describes proposals for new connections between neighbourhoods.\n\nResidents are weighing shorter journeys against the disruption of construction. The details are still evolving, and the original reporting offers different perspectives on the choices ahead.\n\nThis overview reflects the sources available at the time it was generated. Newer developments appear in the news below.',
    generatedAt: '2026-09-20T10:00:00Z',
    sources: [
      {
        id: 'original',
        title: 'Residents discuss transport proposals',
        url: 'https://example.test/source',
        publisher: 'Local Journal',
        publishedAt: null,
      },
    ],
  },
  summaryCheckedAt: '2026-09-20T10:00:00Z',
  newsCheckedAt: '2026-09-20T12:05:00Z',
  newsRevision: 2,
  news: [
    {
      id: 'one',
      title: 'A new chapter for the streets we share',
      url: 'https://example.test/one',
      publisher: 'City Journal',
      publishedAt: '2026-09-20T12:00:00Z',
    },
    {
      id: 'two',
      title:
        'Council publishes updated transport proposals after public consultation',
      url: 'https://example.test/two',
      publisher: 'The Daily Review',
      publishedAt: '2026-09-20T11:00:00Z',
    },
    {
      id: 'three',
      title: 'Neighbourhood groups respond to the latest plans',
      url: 'https://example.test/three',
      publisher: 'Local Dispatch',
      publishedAt: '2026-09-20T10:30:00Z',
    },
    {
      id: 'four',
      title: 'What the changes could mean for everyday journeys',
      url: 'https://example.test/four',
      publisher: 'Morning Edition',
      publishedAt: '2026-09-20T10:00:00Z',
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({ json: topic }),
  );
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: true, localSignup: false },
    }),
  );
});

for (const theme of ['dark', 'light'] as const) {
  test(`topic uses a centered card stream and shared header in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto(`/topics/${id}`);
    await expect(page).toHaveTitle('A changing city — Thinkink');
    await expect(
      page.getByRole('combobox', { name: 'Search a topic' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      topic.title,
    );
    const conversation = page.locator('#discussion');
    await expect(
      conversation.getByRole('link', { name: 'Log in', exact: true }),
    ).toHaveAttribute('href', '/login');
    await expect(
      conversation.getByRole('link', { name: 'Sign up', exact: true }),
    ).toHaveAttribute('href', '/signup');
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const box = (s: string) =>
        document.querySelector(s)!.getBoundingClientRect().toJSON();
      return {
        card: box('.topic-card'),
        search: box('.search-form'),
        discussion: box('#discussion'),
        grid: getComputedStyle(document.querySelector('.news-grid')!)
          .gridTemplateColumns,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.card.width).toBeLessThanOrEqual(660);
    expect(layout.card.left + layout.card.width / 2).toBeCloseTo(
      layout.viewport / 2,
      0,
    );
    expect(layout.card.width).toBeCloseTo(layout.search.width, 0);
    expect(layout.discussion.top).toBeGreaterThan(layout.card.bottom);
    expect(layout.grid.split(' ')).toHaveLength(layout.viewport <= 700 ? 1 : 2);
    await page.screenshot({
      path: testInfo.outputPath(`topic-${theme}.png`),
      fullPage: true,
    });
    await page.getByText('Sources behind this overview').click();
    await expect(
      page.getByRole('link', { name: 'Residents discuss transport proposals' }),
    ).toBeVisible();
    await page.getByRole('link', { name: /^Go to comments/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Comments', exact: true }),
    ).toBeInViewport();
    expect(
      await page
        .locator('.topic-card')
        .first()
        .evaluate((el) => el.getAnimations().length),
    ).toBe(0);
  });
}

test('topic cards reuse the vertical reveal and cancel it for reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 540,
  });
  await page.addInitScript(() => {
    const records: unknown[] = [];
    Object.assign(window, { topicReveals: records });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('topic-card'))
        records.push({ frames, options });
      return animate.call(this, frames, options);
    };
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/topics/${id}`);
  await page.locator('#discussion').scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'topicReveals').length))
    .toBeGreaterThan(0);
  const records = await page.evaluate(() =>
    Reflect.get(window, 'topicReveals'),
  );
  expect(records[0]).toEqual({
    frames: [
      { opacity: 0.45, transform: 'translateY(20px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    options: { duration: 600, easing: 'ease-out' },
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.locator('#discussion').evaluate((el) => el.getAnimations().length),
    )
    .toBe(0);
  await page.reload();
  await page.locator('#discussion').scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => Reflect.get(window, 'topicReveals')),
  ).toEqual([]);
});

test('missing article images fall back to readable reporting', async ({
  page,
}) => {
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        ...topic,
        news: [
          { ...topic.news[0], imageUrl: 'https://example.test/missing.jpg' },
        ],
      },
    }),
  );
  await page.route('https://example.test/missing.jpg', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto(`/topics/${id}`);
  await page.locator('.news-story--lead').scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('link', { name: topic.news[0]!.title }),
  ).toBeVisible();
  await expect(page.locator('.news-image')).toHaveCount(0);
});

for (const [width, height, accepted] of [
  [120, 90, false],
  [960, 540, true],
] as const) {
  test(`lead image quality gate: ${width}x${height}`, async ({ page }) => {
    await page.route(`**/api/topics/${id}`, (route) =>
      route.fulfill({
        json: {
          ...topic,
          news: [
            { ...topic.news[0], imageUrl: 'https://example.test/quality.svg' },
          ],
        },
      }),
    );
    await page.route('https://example.test/quality.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="purple"/></svg>`,
      }),
    );
    await page.goto(`/topics/${id}`);
    await page.locator('.news-story--lead').scrollIntoViewIfNeeded();
    if (accepted) {
      await expect(page.locator('.news-image')).toBeVisible();
      await expect(page.locator('.news-image')).toHaveJSProperty(
        'naturalWidth',
        width,
      );
    } else {
      await expect(page.locator('.news-image')).toHaveCount(0);
      await expect(page.locator('.news-image-frame svg')).toBeVisible();
    }
    await expect(
      page.getByRole('link', { name: topic.news[0]!.title }),
    ).toBeVisible();
  });
}
