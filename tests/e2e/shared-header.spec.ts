import { expect, test } from '@playwright/test';

const id = 'cda32e79-7079-49f1-a423-d506f93472f8';
const topic = {
  id,
  title: 'A changing city',
  summary: null,
  summaryCheckedAt: null,
  news: [],
  newsCheckedAt: null,
  newsRevision: 0,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        user: null,
        available: true,
        localSignup: false,
      },
    }),
  );
  await page.route('**/api/home', (route) =>
    route.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({ json: topic }),
  );
});

test('topic navigation never leaves duplicate search fields in the shared header', async ({
  page,
}) => {
  await page.route('**/api/topics/search?**', (route) =>
    route.fulfill({
      json: {
        topics: [{ id, title: topic.title, createdAt: '2026-09-20T10:00:00Z' }],
      },
    }),
  );
  await page.goto(`/topics/${id}`);
  for (let visit = 0; visit < 3; visit++) {
    await expect(page.getByRole('search')).toHaveCount(1);
    await expect(page.getByRole('progressbar')).toHaveCount(1);
    await page.getByRole('link', { name: 'Thinkink home' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('search')).toHaveCount(1);
    await expect(page.locator('#topic-search')).toHaveCount(1);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'Search a topic' })
      .fill(topic.title);
    await page.getByRole('option', { name: topic.title }).click();
    await expect(page).toHaveURL(`/topics/${id}`);
  }
  await page.goBack();
  await expect(page.getByRole('search')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('search')).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveCount(1);
});

test('header finishes both directions at rest and ignores small scroll reversals', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(() => {
    document.body.style.minHeight = '4000px';
  });
  const progress = () =>
    page
      .locator('.header-shell')
      .evaluate((el) => Number(el.style.getPropertyValue('--header-progress')));
  // The same position inside the threshold gap keeps the previous complete
  // layout, rather than oscillating when a trackpad changes direction slightly.
  for (const [top, expected] of [
    [60, 0],
    [80, 1],
    [60, 1],
    [32, 0],
    [60, 0],
  ]) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), top);
    await expect.poll(progress).toBe(expected);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 320)),
    );
    expect(await progress()).toBe(expected);
    expect(await page.evaluate(() => scrollY)).toBe(top);
  }
});

test('mobile header uses native sticky positioning through scroll start and viewport height changes', async ({
  page,
}) => {
  test.skip(page.viewportSize()!.width > 700, 'Mobile native scroll behavior');
  for (const path of ['/', '/mission/']) {
    await page.goto(path);
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.body.style.minHeight = '4000px';
    });
    await expect(page.locator('.header-shell')).toHaveCSS('position', 'sticky');
    const mainTop = await page
      .locator('main')
      .evaluate((el) => el.getBoundingClientRect().top + scrollY);
    for (const top of [1, 24, 79, 120, 600, 30, 0, 2, 0]) {
      await page.evaluate(async (y) => {
        scrollTo({ top: y, behavior: 'instant' });
        await new Promise(requestAnimationFrame);
      }, top);
      const pose = await page.evaluate(() => ({
        top: document.querySelector('.site-header')!.getBoundingClientRect()
          .top,
        position: getComputedStyle(document.querySelector('.site-header')!)
          .position,
        mainTop:
          document.querySelector('main')!.getBoundingClientRect().top + scrollY,
      }));
      expect(pose).toEqual({ top: 0, position: 'absolute', mainTop });
    }
    await page.evaluate(() => scrollTo({ top: 600, behavior: 'instant' }));
    for (const height of [700, 850, 720]) {
      await page.setViewportSize({ width: page.viewportSize()!.width, height });
      await expect
        .poll(() =>
          page
            .locator('.site-header')
            .evaluate((el) => el.getBoundingClientRect().top),
        )
        .toBe(0);
    }
    // The stable expanded spacer must not block taps on content below the
    // compact header, even though its sticky box is taller than the header.
    await expect
      .poll(() =>
        page
          .locator('.header-shell')
          .evaluate((el) => el.style.getPropertyValue('--header-progress')),
      )
      .toBe('1.0000');
    expect(
      await page.evaluate(
        () =>
          document.elementFromPoint(20, 100)?.closest('.header-shell') === null,
      ),
    ).toBe(true);
  }
});

test('settled header stays stable during fast scrolling without rewriting its layout', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.body.style.minHeight = '4000px';
    scrollTo({ top: 160, behavior: 'instant' });
  });
  await expect
    .poll(() =>
      page
        .locator('.header-shell')
        .evaluate((el) => el.style.getPropertyValue('--header-progress')),
    )
    .toBe('1.0000');
  const result = await page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>('.header-shell')!;
    const header = document.querySelector<HTMLElement>('.site-header')!;
    const main = document.querySelector('main')!;
    const nextFrame = () => new Promise(requestAnimationFrame);
    await nextFrame();
    await nextFrame();
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(shell, { attributes: true });
    const poses = [];
    for (const top of [400, 900, 200, 1200, 100]) {
      scrollTo({ top, behavior: 'instant' });
      await nextFrame();
      await nextFrame();
      poses.push({
        top: header.getBoundingClientRect().top,
        height: header.getBoundingClientRect().height,
        mainTop: main.getBoundingClientRect().top + scrollY,
      });
    }
    observer.disconnect();
    return { mutations, poses };
  });
  expect(result.mutations).toBe(0);
  for (const pose of result.poses) {
    expect(pose.top).toBe(0);
    expect(pose).toEqual(result.poses[0]);
  }
});

test('header can reverse mid-transition and reduced motion settles immediately', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const reversal = await page.evaluate(async () => {
    document.body.style.minHeight = '4000px';
    const shell = document.querySelector<HTMLElement>('.header-shell')!;
    const progress = () =>
      Number(shell.style.getPropertyValue('--header-progress'));
    const nextFrame = () => new Promise(requestAnimationFrame);
    scrollTo({ top: 80, behavior: 'instant' });
    for (let frame = 0; frame < 120; frame++) {
      await nextFrame();
      if (progress() > 0 && progress() < 1) {
        const interrupted = progress();
        scrollTo({ top: 24, behavior: 'instant' });
        for (let end = 0; end < 120; end++) {
          await nextFrame();
          if (progress() === 0)
            return { interrupted, final: progress(), y: scrollY };
        }
        break;
      }
    }
    throw new Error('Header did not finish its interrupted transition');
  });
  expect(reversal.interrupted).toBeGreaterThan(0);
  expect(reversal.interrupted).toBeLessThan(1);
  expect(reversal.final).toBe(0);
  expect(reversal.y).toBe(24);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [top, expected] of [
    [80, 1],
    [24, 0],
  ]) {
    const frames = await page.evaluate(async (y) => {
      const values: number[] = [];
      scrollTo({ top: y, behavior: 'instant' });
      for (let frame = 0; frame < 4; frame++) {
        await new Promise(requestAnimationFrame);
        values.push(
          Number(
            document
              .querySelector<HTMLElement>('.header-shell')!
              .style.getPropertyValue('--header-progress'),
          ),
        );
      }
      return values;
    }, top);
    expect(frames.every((value) => value === 0 || value === 1)).toBe(true);
    expect(frames.at(-1)).toBe(expected);
  }
});

test('every section shares search dimensions and scroll compaction', async ({
  page,
}) => {
  const layouts: unknown[] = [];
  for (const path of ['/', '/mission/', `/topics/${id}`, '/not-a-page']) {
    await page.goto(path);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(
      page.getByRole('combobox', { name: 'Search a topic' }),
    ).toBeVisible();
    await expect(page.locator('.header-account')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.body.style.minHeight = '4000px';
      scrollTo({ top: 0, behavior: 'instant' });
    });
    const measure = () =>
      page.locator('.site-header').evaluate((el) => {
        const search = el
          .querySelector('.search-form')!
          .getBoundingClientRect();
        return {
          height: el.getBoundingClientRect().height,
          searchWidth: search.width,
          searchHeight: search.height,
        };
      });
    const expanded = await measure();
    const overflow = await page
      .locator('.site-header a, .site-header button, .search-form')
      .evaluateAll((elements) =>
        elements.some((el) => {
          const box = el.getBoundingClientRect();
          return box.left < 0 || box.right > innerWidth;
        }),
      );
    expect(overflow, `header controls fit on ${path}`).toBe(false);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(
      nav.getByRole('link', { name: 'Explore', exact: true }),
    ).toHaveCount(path === '/' ? 0 : 1);
    await expect(
      nav.getByRole('link', { name: 'Mission', exact: true }),
    ).toHaveCount(path === '/mission/' || path.startsWith('/topics/') ? 0 : 1);
    await page.evaluate(() => scrollTo({ top: 160, behavior: 'instant' }));
    await expect
      .poll(() =>
        page
          .locator('.header-shell')
          .evaluate((el) => el.style.getPropertyValue('--header-progress')),
      )
      .toBe('1.0000');
    const compact = await measure();
    expect(compact.height).toBeLessThan(expanded.height - 40);
    expect(compact.height).toBeLessThanOrEqual(60);
    layouts.push({ expanded, compact });
  }
  layouts.forEach((layout) => expect(layout).toEqual(layouts[0]));
});

test('compact header keeps search between the logo and controls on narrow screens', async ({
  page,
}) => {
  for (const width of [360, 393, 600, 894]) {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/mission/');
    await expect(page.locator('.header-account')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
      scrollTo({ top: 160, behavior: 'instant' });
    });
    await expect
      .poll(() =>
        page
          .locator('.header-shell')
          .evaluate((el) => el.style.getPropertyValue('--header-progress')),
      )
      .toBe('1.0000');
    const bounds = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        logo: box('.wordmark'),
        search: box('.search-form'),
        actions: box('.header-actions'),
        input: box('#topic-search'),
        header: box('.site-header'),
      };
    });
    expect(bounds.header.height).toBeLessThanOrEqual(60);
    expect(bounds.search.left).toBeGreaterThan(bounds.logo.right);
    expect(bounds.search.right).toBeLessThan(bounds.actions.left);
    expect(bounds.input.width).toBeGreaterThan(30);
    await expect(page.locator('.header-inner nav')).not.toBeVisible();
    await page
      .getByRole('combobox', { name: 'Search a topic' })
      .fill('Climate');
    await expect(
      page.getByRole('combobox', { name: 'Search a topic' }),
    ).toHaveValue('Climate');
    await page
      .getByRole('combobox', { name: 'Search a topic' })
      .press('Shift+Tab');
    await expect(
      page.getByRole('button', { name: /Switch to .* theme/ }),
    ).toBeFocused();
  }
});

test('Mission search loads the actual topic page and preserves search there', async ({
  page,
}) => {
  await page.route('**/api/topics/search?**', (route) =>
    route.fulfill({
      json: {
        topics: [
          {
            id: topic.id,
            title: topic.title,
            createdAt: '2026-09-20T10:00:00Z',
          },
        ],
      },
    }),
  );
  await page.goto('/mission/');
  const search = page.getByRole('combobox', { name: 'Search a topic' });
  await search.fill('A changing city');
  await search.press('Enter');
  await expect(page).toHaveURL(`/topics/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(topic.title);
  await expect(page.locator('.mission-page')).toHaveCount(0);
  await expect(search).toBeVisible();
  await expect(search).toHaveValue('');
});

test('Mission uses shared validation and missing-topic sign-in navigation', async ({
  page,
}) => {
  await page.route('**/api/topics/search?**', (route) =>
    route.fulfill({
      json: { topics: [] },
    }),
  );
  await page.goto('/mission/');
  await page
    .getByRole('button', { name: 'Search topics', exact: true })
    .click();
  await expect(page.locator('.search-popover')).toHaveCount(0);
  const input = page.getByRole('combobox', { name: 'Search a topic' });
  await input.fill('p');
  await expect(page.locator('.search-popover')).toHaveCount(0);
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('Enter');
  await expect(page.locator('.search-popover')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Search a topic' })
    .fill('An unstarted topic');
  await page
    .getByRole('button', { name: 'Search topics', exact: true })
    .click();
  await page
    .locator('#search-result')
    .getByRole('link', { name: 'Log in', exact: true })
    .click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Welcome',
  );
  await expect(page.locator('.mission-page')).toHaveCount(0);
  await expect(
    page.getByRole('combobox', { name: 'Search a topic' }),
  ).toHaveCount(0);
});
