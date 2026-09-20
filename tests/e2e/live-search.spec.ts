import { expect, test } from '@playwright/test';

const topics = [
  {
    id: 'cf49cd9b-f0f3-4e41-aa0c-c6c8afdb1bc0',
    title: 'War in Iran',
    createdAt: '2026-09-20T12:00:00Z',
  },
  {
    id: 'cf49cd9b-f0f3-4e41-aa0c-c6c8afdb1bc1',
    title: 'Iran today',
    createdAt: '2026-09-20T11:00:00Z',
  },
  {
    id: 'cf49cd9b-f0f3-4e41-aa0c-c6c8afdb1bc2',
    title: 'The latest news from Iran',
    createdAt: '2026-09-20T10:00:00Z',
  },
];
const anonymous = { user: null, available: true, localSignup: true };

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: anonymous }),
  );
  await page.route('**/api/home', (route) =>
    route.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
  await page.route('**/api/topics/search?**', (route) => {
    const query = new URL(route.request().url()).searchParams
      .get('q')!
      .toLowerCase();
    return route.fulfill({
      json: {
        topics: topics.filter((topic) =>
          topic.title.toLowerCase().includes(query),
        ),
      },
    });
  });
});

test('live suggestions overlay the page and support keyboard selection', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route(`**/api/topics/${topics[1]!.id}`, (route) =>
    route.fulfill({
      json: {
        ...topics[1],
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Search a topic' });
  const initialTop = await page
    .locator('main')
    .evaluate((el) => el.getBoundingClientRect().top);
  await input.fill('iran');
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(
    await page.locator('main').evaluate((el) => el.getBoundingClientRect().top),
  ).toBe(initialTop);
  const geometry = await page.evaluate(() => {
    const bubble = document
      .querySelector('.search-popover')!
      .getBoundingClientRect();
    const search = document
      .querySelector('.search-form')!
      .getBoundingClientRect();
    return {
      left: bubble.left,
      right: bubble.right,
      top: bubble.top,
      searchBottom: search.bottom,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThan(geometry.searchBottom);
  expect(geometry.overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('live-search-dark.png') });
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(
    page.getByRole('option', { name: 'Iran today' }),
  ).toHaveAttribute('aria-selected', 'true');
  await input.press('Enter');
  await expect(page).toHaveURL(`/topics/${topics[1]!.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Iran today',
  );
});

test('missing results offer both authentication paths without creating anything', async ({
  page,
}) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/topics'))
      writes.push(request.url());
  });
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Search a topic' });
  await input.fill('An unstarted conversation');
  const result = page.locator('#search-result');
  await expect(result).toContainText(
    'No topic yet for An unstarted conversation.',
  );
  await expect(
    result.getByRole('link', { name: 'Log in', exact: true }),
  ).toHaveAttribute('href', '/login');
  await expect(
    result.getByRole('link', { name: 'Sign up', exact: true }),
  ).toHaveAttribute('href', '/signup');
  await expect(result.getByRole('button')).toHaveCount(0);
  await input.press('Enter');
  expect(writes).toEqual([]);
  await result.getByRole('link', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL('/signup');
});

test('escape, outside clicks and clearing close the bubble; compact headers keep it within the viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.style.minHeight = '3500px';
    scrollTo({ top: 300, behavior: 'instant' });
  });
  const input = page.getByRole('combobox', { name: 'Search a topic' });
  await input.fill('iran');
  await expect(page.getByRole('option')).toHaveCount(3);
  const bounds = await page.locator('.search-popover').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await input.press('Escape');
  await expect(page.locator('.search-popover')).toHaveCount(0);
  await input.press('ArrowDown');
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.locator('main').click({ position: { x: 5, y: 400 } });
  await expect(page.locator('.search-popover')).toHaveCount(0);
  await input.click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('.search-popover')).toHaveCount(0);
});

test('a failed lookup never offers creation and can be retried', async ({
  page,
}) => {
  let failed = true;
  await page.route('**/api/topics/search?**', (route) =>
    failed
      ? route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'CATALOG_UNAVAILABLE',
              message: 'Search is temporarily unavailable.',
            },
          },
        })
      : route.fulfill({ json: { topics } }),
  );
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search a topic' }).fill('iran');
  await expect(page.getByRole('alert')).toContainText(
    'temporarily unavailable',
  );
  await expect(page.locator('#search-result')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
});

test('a delayed older query cannot replace newer suggestions or reopen a dismissed bubble', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/topics/search?**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'iran') {
      started();
      await gate;
    }
    await route.fulfill({ json: { topics: query === 'iran' ? topics : [] } });
  });
  try {
    await page.goto('/');
    const input = page.getByRole('combobox', { name: 'Search a topic' });
    await input.fill('iran');
    await began;
    await input.fill('Ocean policy');
    await expect(page.locator('#search-result')).toContainText('Ocean policy');
    release();
    await expect(page.getByRole('option')).toHaveCount(0);
    await input.fill('iran');
    await input.press('Escape');
    await expect(page.locator('.search-popover')).toHaveCount(0);
    await input.press('ArrowDown');
    await expect(page.getByRole('option')).toHaveCount(3);
  } finally {
    release();
  }
});

test('creation action sits to the left of the missing-topic message', async ({
  page,
}, testInfo) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        ...anonymous,
        user: {
          id: 'cf49cd9b-f0f3-4e41-aa0c-c6c8afdb1bc9',
          email: 'layout@example.test',
          profile: {
            username: 'layout_reader',
            avatar: null,
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Search a topic' })
    .fill('An unstarted conversation');
  const action = page.getByRole('button', {
    name: 'Start this topic',
    exact: true,
  });
  await expect(action).toBeVisible();
  const button = (await action.boundingBox())!;
  const message = (await page.locator('#search-result > p').boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(message.x);
  expect(button.y).toBeLessThan(message.y + message.height);
  expect(message.y).toBeLessThan(button.y + button.height);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('creation-left.png') });
});

test('partial suggestions still offer creation while exact titles do not', async ({
  page,
}, testInfo) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        ...anonymous,
        user: {
          id: 'cf49cd9b-f0f3-4e41-aa0c-c6c8afdb1bc9',
          email: 'reader@example.test',
          profile: {
            username: 'search_reader',
            avatar: null,
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.route('**/api/topics/search?**', (route) =>
    route.fulfill({ json: { topics } }),
  );
  let createdTitle = '';
  await page.route('**/api/topics', (route) => {
    createdTitle = (route.request().postDataJSON() as { title: string }).title;
    return route.fulfill({
      status: 401,
      json: { error: { code: 'SIGN_IN_REQUIRED', message: 'Sign in again.' } },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const input = page.getByRole('combobox', { name: 'Search a topic' });
  await input.fill('  WAR IN IRAN  ');
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.locator('#search-result')).toHaveCount(0);
  await input.fill('Iranian war updates');
  const action = page.getByRole('button', {
    name: 'Start this topic',
    exact: true,
  });
  await expect(action).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(3);
  const button = (await action.boundingBox())!;
  const message = (await page.locator('#search-result > p').boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(message.x);
  await page.screenshot({
    path: testInfo.outputPath('partial-suggestions.png'),
  });
  await action.click();
  expect(createdTitle).toBe('Iranian war updates');
  await expect(
    page
      .locator('#search-result')
      .getByRole('link', { name: 'Log in', exact: true }),
  ).toBeVisible();
});

test('typing has no loading copy and retains suggestions without enabling stale creation', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/topics/search?**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('q');
    if (query === 'iran updates') {
      started();
      await gate;
    }
    await route.fulfill({ json: { topics } });
  });
  try {
    await page.goto('/');
    const input = page.getByRole('combobox', { name: 'Search a topic' });
    await input.fill('iran');
    await expect(
      page.getByText('Finding topics', { exact: false }),
    ).toHaveCount(0);
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(
      page
        .locator('#search-result')
        .getByRole('link', { name: 'Log in', exact: true }),
    ).toBeVisible();
    await input.fill('iran updates');
    await began;
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('listbox')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(
      page.getByText('Finding topics', { exact: false }),
    ).toHaveCount(0);
    await expect(page.locator('#search-result')).toHaveCount(0);
    release();
    await expect(page.locator('#search-result')).toContainText('iran updates');
    await expect(page.getByRole('listbox')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  } finally {
    release();
  }
});
