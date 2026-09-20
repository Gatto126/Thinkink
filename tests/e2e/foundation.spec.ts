import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/home', (route) =>
    route.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
});

test('home shows an empty catalogue and validates search', async ({ page }) => {
  await page.route('**/api/topics/search?**', (route) =>
    route.fulfill({
      json: { topics: [] },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Stay curious.',
  );
  await expect(
    page.getByRole('heading', { name: 'Latest topic' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Most visited' }),
  ).toBeVisible();
  await expect(
    page.getByText('Every topic starts with a question.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Search topics', exact: true })
    .click();
  await expect(page.locator('.search-popover')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Search a topic' })
    .fill('Climate policy');
  await page
    .getByRole('button', { name: 'Search topics', exact: true })
    .click();
  await expect(page.locator('#search-result')).toContainText(
    'No topic yet for Climate policy.',
  );
  await expect(
    page
      .locator('#search-result')
      .getByRole('link', { name: 'Log in', exact: true }),
  ).toHaveAttribute('href', '/login');
  await expect(
    page
      .locator('#search-result')
      .getByRole('link', { name: 'Sign up', exact: true }),
  ).toHaveAttribute('href', '/signup');
  await expect(
    page.getByRole('button', { name: 'Start this topic', exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('mission contains readable static HTML without JavaScript or API requests', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url());
  });
  const response = await page.goto(`${baseURL}/mission/`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Shared attention.',
  );
  await expect(
    page.getByRole('heading', {
      name: 'Follow the topic. Join the conversation.',
    }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
  await context.close();
});

for (const system of ['light', 'dark'] as const) {
  test(`starts with ${system} system theme and offers the opposite choice`, async ({
    page,
  }) => {
    const opposite = system === 'dark' ? 'light' : 'dark';
    await page.emulateMedia({ colorScheme: system });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', system);
    await page
      .getByRole('button', { name: `Switch to ${opposite} theme` })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', opposite);
    await page.emulateMedia({ colorScheme: opposite });
    await page.emulateMedia({ colorScheme: system });
    await expect(page.locator('html')).toHaveAttribute('data-theme', opposite);
    await page.getByRole('link', { name: 'Mission' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', opposite);
    await page
      .getByRole('button', { name: `Switch to ${system} theme` })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', system);
    await page.getByRole('link', { name: 'Thinkink home' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', system);
    await expect(
      page.getByRole('button', { name: `Switch to ${opposite} theme` }),
    ).toBeVisible();
  });
}

test('follows system changes until the visitor selects a theme', async ({
  page,
}) => {
  for (const path of ['/', '/mission/']) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(path);
    await expect(
      page.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeVisible();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(
      page.getByRole('button', { name: 'Switch to dark theme' }),
    ).toBeVisible();
  }
});

test('sign-in and invited signup screens are reachable without submitting credentials', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: { user: null, available: false, localSignup: false },
    }),
  );
  const authRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth') && request.method() !== 'GET')
      authRequests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Welcome',
  );
  await page.getByLabel('Email address').fill('preview@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Preview-only-passphrase');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('search')).toHaveCount(0);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(
    page.getByText('3–30 letters, numbers or underscores.', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Use at least 12 characters.', { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Password', { exact: true }).fill('a');
  expect(
    await page
      .getByLabel('Password', { exact: true })
      .evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(true);
  await expect(page).toHaveTitle('Create account — Thinkink');
  // Focusing a lower field can legitimately scroll it into view.
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Invitation code')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create account' }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto('/mission/');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('search')).toHaveCount(0);
  expect(authRequests).toEqual([]);
});

test('topic view keeps overview sources separate from newer news', async ({
  page,
}) => {
  // These responses exist only in this browser test, never in the application.
  const id = 'cda32e79-7079-49f1-a423-d506f93472f8';
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        title: 'A changing city',
        summary: {
          id: 'a9d5174b-9093-4da4-a4be-29f6a795055d',
          text: 'Local reporting describes a public discussion about the city’s transport plans.',
          generatedAt: '2026-09-20T10:00:00Z',
          sources: [
            {
              id: 'original',
              title: 'Residents discuss transport proposals',
              url: 'https://example.com/overview-source',
              publisher: 'Test publisher',
              publishedAt: null,
            },
          ],
        },
        summaryCheckedAt: '2026-09-20T10:00:00Z',
        news: [
          {
            id: 'new',
            title: 'Council publishes an updated transport proposal',
            url: 'https://example.com/new-report',
            publisher: 'Test publisher',
            publishedAt: '2026-09-20T12:00:00Z',
          },
        ],
        newsCheckedAt: '2026-09-20T12:05:00Z',
        newsRevision: 2,
      },
    }),
  );
  await page.goto(`/topics/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'A changing city',
  );
  await expect(
    page.getByRole('link', {
      name: 'Council publishes an updated transport proposal',
    }),
  ).toBeVisible();
  await page.getByText('Sources behind this overview').click();
  await expect(
    page.getByRole('link', { name: 'Residents discuss transport proposals' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const path of ['/', '/mission/']) {
  test(`perspective artwork visibly responds to vertical scrolling on ${path}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(path);
    const center = page.locator('.art-center');
    const initial = await center.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).m42,
    );
    await page.mouse.wheel(0, 280);
    await expect
      .poll(async () =>
        center.evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).m42,
        ),
      )
      .toBeGreaterThan(initial + 25);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(center).toHaveCSS('transform', 'none');
    await expect(page.locator('.perspective-rings')).toHaveCSS(
      'transform',
      'none',
    );
  });
}

test('artwork uses the same scroll distance on Home and Mission regardless of content height', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const positions: string[] = [];
  for (const path of ['/', '/mission/']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (path === '/')
      await expect(
        page.getByText('Every topic starts with a question.'),
      ).toBeVisible();
    // Additional content must not slow down the animation.
    await page.evaluate(async () => {
      // Finish font/layout changes before measuring an exact scroll position.
      await document.fonts.ready;
      document.body.style.minHeight = '6000px';
      window.scrollTo({ top: 140, behavior: 'instant' });
    });
    await expect
      .poll(() =>
        page
          .locator('.perspective-art')
          .evaluate((element) =>
            element.style.getPropertyValue('--perspective-progress'),
          ),
      )
      .toBe('0.3500');
    positions.push(
      await page
        .locator('.art-center')
        .evaluate((element) => getComputedStyle(element).transform),
    );
    if (path === '/') {
      await page.evaluate(() => {
        document.body.style.minHeight = '8000px';
      });
      expect(
        await page
          .locator('.art-center')
          .evaluate((element) => getComputedStyle(element).transform),
      ).toBe(positions[0]);
    }
  }
  expect(positions[0]).toBe(positions[1]);
});
