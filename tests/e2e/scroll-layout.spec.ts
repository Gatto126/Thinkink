import { expect, test } from '@playwright/test';

test('fixed header completes compaction after scrolling stops without moving content or losing controls', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: '7e225d51-cbc2-4db4-a07c-105c1f881913',
          email: 'scroll-test@example.test',
          profile: {
            username: 'scroll_test',
            avatar: { id: 'iris', label: 'Iris', src: '/avatars/iris.svg' },
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.emulateMedia({
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
  });
  await page.goto('/');
  await expect(page.locator('.header-account')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.body.style.minHeight = '4000px';
  });
  const measure = () =>
    page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        header: box('.site-header'),
        search: box('.search-form'),
        logo: box('.wordmark'),
        theme: box('.theme-control'),
        avatar: box('.avatar-link'),
        mainTop: box('main').top + scrollY,
      };
    });
  const expanded = await measure();
  await expect(
    page
      .getByRole('navigation')
      .getByRole('link', { name: 'Explore', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => scrollTo({ top: 80, behavior: 'instant' }));
  await expect
    .poll(() =>
      page
        .locator('.header-shell')
        .evaluate((el) => el.style.getPropertyValue('--header-progress')),
    )
    .toBe('1.0000');
  expect(await page.evaluate(() => scrollY)).toBe(80);
  const compact = await measure();
  expect(compact.header.top).toBe(0);
  expect(compact.header.height).toBeLessThan(expanded.header.height - 40);
  expect(compact.mainTop).toBe(expanded.mainTop);
  expect(compact.search.top).toBeLessThan(expanded.search.top);
  expect(compact.logo.left).toBeLessThan(expanded.logo.left);
  expect(compact.avatar.right).toBeGreaterThan(expanded.avatar.right);
  expect(compact.avatar.width).toBeLessThan(expanded.avatar.width);
  expect(compact.header.height).toBeLessThanOrEqual(60);
  const centerY = (box: { top: number; height: number }) =>
    box.top + box.height / 2;
  expect(
    Math.abs(centerY(compact.search) - centerY(compact.logo)),
  ).toBeLessThan(2);
  expect(
    Math.abs(centerY(compact.search) - centerY(compact.avatar)),
  ).toBeLessThan(2);
  expect(compact.search.left).toBeGreaterThan(compact.logo.right);
  expect(compact.search.right).toBeLessThan(compact.avatar.left);
  await expect(page.locator('.header-inner nav')).toHaveAttribute('inert', '');
  await expect(page.locator('.header-inner nav')).not.toBeVisible();
  expect(compact.theme.width).toBeCloseTo(compact.theme.height, 0);
  await page.getByRole('combobox', { name: 'Search a topic' }).fill('science');
  await expect(
    page.getByRole('button', { name: 'Search topics', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => scrollTo({ top: 32, behavior: 'instant' }));
  await expect
    .poll(async () => (await measure()).header.height)
    .toBe(expanded.header.height);
  expect(await page.evaluate(() => scrollY)).toBe(32);
  await expect(page.locator('.header-inner nav')).toBeVisible();
  await page.getByRole('link', { name: 'Mission', exact: true }).click();
  await expect(
    page
      .getByRole('navigation')
      .getByRole('link', { name: 'Mission', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation')
      .getByRole('link', { name: 'Explore', exact: true }),
  ).toBeVisible();
});

test('Home and Mission share artwork proportions and allow vertical motion outside the hero', async ({
  page,
}) => {
  const sizes: number[] = [];
  for (const path of ['/', '/mission/']) {
    await page.goto(path);
    await expect(page.locator('.perspective-art')).toBeAttached();
    sizes.push(
      await page
        .locator('.perspective-art')
        .evaluate((el) => el.getBoundingClientRect().width),
    );
    const clippedBy = await page.locator('.art-center').evaluate((el) => {
      const clipped: string[] = [];
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (
          ['hidden', 'clip', 'auto', 'scroll'].includes(
            getComputedStyle(ancestor).overflowY,
          )
        )
          clipped.push(ancestor.className);
        ancestor = ancestor.parentElement;
      }
      return clipped;
    });
    expect(clippedBy).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(sizes[0]).toBe(sizes[1]);
});

test('topic cards and empty cards use Mission reveal motion and respect reduced motion', async ({
  page,
}) => {
  // Exercise scroll entry, not content already visible on initial navigation.
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: 400,
  });
  await page.addInitScript(() => {
    const records: { tag: string; duration: number; frames: unknown }[] = [];
    Object.assign(window, { revealRecords: records });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('reveal'))
        records.push({
          tag: this.tagName,
          duration: Number(
            typeof options === 'object' ? options.duration : options,
          ),
          frames,
        });
      return animate.call(this, frames, options);
    };
  });
  await page.route('**/api/home', (route) =>
    route.fulfill({
      json: {
        mostVisited: [
          {
            id: 'cda32e79-7079-49f1-a423-d506f93472f8',
            title: 'A changing city',
            createdAt: '2026-09-20T10:00:00Z',
          },
        ],
        latest: [],
      },
    }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page
    .getByRole('link', { name: 'A changing city' })
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, 'revealRecords').some(
          (record: { tag: string }) => record.tag === 'LI',
        ),
      ),
    )
    .toBe(true);
  await page.locator('.empty-list').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, 'revealRecords').some(
          (record: { tag: string }) => record.tag === 'DIV',
        ),
      ),
    )
    .toBe(true);
  const card = await page.evaluate(
    () => Reflect.get(window, 'revealRecords')[0],
  );
  await page.goto('/mission/');
  await page.locator('.mission-intro').scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, 'revealRecords').length),
    )
    .toBeGreaterThan(0);
  const mission = await page.evaluate(
    () => Reflect.get(window, 'revealRecords')[0],
  );
  expect(card.duration).toBe(600);
  expect(card.duration).toBe(mission.duration);
  expect(card.frames).toEqual(mission.frames);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.empty-list').scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => Reflect.get(window, 'revealRecords')),
  ).toEqual([]);
  await expect(page.locator('.art-center')).toHaveCSS('transform', 'none');
});
