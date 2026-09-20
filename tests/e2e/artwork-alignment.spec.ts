import { expect, test } from '@playwright/test';

test('Explore and Mission share desktop artwork and keep mobile Explore artwork beside its heading', async ({
  page,
}) => {
  await page.route('**/api/home', (route) =>
    route.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [360, 700, 894, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const pages: unknown[][] = [];
    const headings: unknown[] = [];
    for (const path of ['/', '/mission/']) {
      await page.goto(path);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.body.style.minHeight = '4000px';
      });
      const poses: unknown[] = [];
      for (const scroll of [0, 140, 400]) {
        await page.evaluate(
          (top) => scrollTo({ top, behavior: 'instant' }),
          scroll,
        );
        await expect
          .poll(() =>
            page
              .locator('.perspective-art')
              .evaluate((el) =>
                el.style.getPropertyValue('--perspective-progress'),
              ),
          )
          .toBe((scroll / 400).toFixed(4));
        if (scroll === 0) {
          headings.push(
            await page.locator('h1').evaluate((el) => {
              const { x, y } = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              return {
                x,
                y,
                font: style.font,
                letterSpacing: style.letterSpacing,
              };
            }),
          );
        }
        poses.push(
          await page
            .locator(
              '.perspective-art, .perspective-rings, .art-ring, .art-center, .art-caption',
            )
            .evaluateAll((elements) =>
              elements.map((el) => {
                const { x, y, width, height } = el.getBoundingClientRect();
                const style = getComputedStyle(el);
                return {
                  x,
                  y,
                  width: el.classList.contains('art-caption')
                    ? undefined
                    : width,
                  height,
                  opacity: style.opacity,
                  transform: style.transform,
                };
              }),
            ),
        );
      }
      pages.push(poses);
    }
    if (width > 700) {
      expect(
        pages[1],
        `artwork remains anchored at viewport width ${width}`,
      ).toEqual(pages[0]);
    } else {
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const box = (selector: string) =>
          document.querySelector(selector)!.getBoundingClientRect();
        const heading = box('h1');
        const art = box('.home-art');
        const letter = box('.home-art .art-center');
        const catalogue = box('.catalogue');
        return {
          gap: art.top - heading.bottom,
          letterGap: letter.top - heading.bottom,
          artBottom: art.bottom,
          catalogueTop: catalogue.top,
        };
      });
      expect(layout.gap).toBeGreaterThanOrEqual(0);
      expect(layout.gap).toBeLessThan(24);
      expect(layout.letterGap).toBeLessThan(100);
      expect(layout.artBottom).toBeLessThan(layout.catalogueTop);
    }
    expect(headings[1], `matching hero title style at ${width}px`).toEqual(
      headings[0],
    );
  }
});
