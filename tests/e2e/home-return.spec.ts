import { expect, test } from '@playwright/test';

for (const unavailable of [true, false]) {
  test(`returning from Mission keeps visible cards stable (${unavailable ? 'unavailable' : 'empty'} feed)`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: page.viewportSize()!.width,
      height: 1116,
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const calls: string[] = [];
      Object.assign(window, { revealCalls: calls });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.classList.contains('reveal')) calls.push(this.className);
        return animate.call(this, frames, options);
      };
    });
    let releaseFeed!: () => void;
    const feedReady = new Promise<void>((resolve) => {
      releaseFeed = resolve;
    });
    await page.route('**/api/home', async (route) => {
      await feedReady;
      await route.fulfill(
        unavailable
          ? {
              status: 503,
              json: {
                error: {
                  code: 'UNAVAILABLE',
                  message:
                    'Topic search is not available yet. Please come back soon.',
                },
              },
            }
          : { json: { latest: [], mostVisited: [] } },
      );
    });
    await page.goto('/mission/');
    await page.getByRole('link', { name: 'Explore', exact: true }).click();
    await expect(page.locator('.list-skeleton')).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    const positions = () =>
      page.locator('.topic-list-section, .empty-list').evaluateAll((elements) =>
        elements.map((element) => {
          const { top, height } = element.getBoundingClientRect();
          return { top, height };
        }),
      );
    const loading = await positions();
    releaseFeed();
    await expect(page.locator('.list-skeleton')).toHaveCount(0);
    await expect(page.locator('.empty-list.reveal')).toHaveCount(2);
    if (unavailable)
      await expect(page.getByRole('status')).toContainText('not available yet');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const loaded = await positions();
    loaded.forEach((box, index) => {
      expect(Math.abs(box.top - loading[index]!.top)).toBeLessThan(1);
      expect(Math.abs(box.height - loading[index]!.height)).toBeLessThan(1);
    });
    expect(
      await page.evaluate(() => Reflect.get(window, 'revealCalls')),
    ).toEqual([]);
    for (const card of await page.locator('.empty-list').all()) {
      await expect(card).toHaveCSS('opacity', '1');
      await expect(card).toHaveCSS('transform', 'none');
    }
  });
}
