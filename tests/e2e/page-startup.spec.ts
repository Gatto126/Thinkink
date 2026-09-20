import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  for (const path of ['/', '/mission/']) {
    test(`${path} applies saved ${theme} appearance before application scripts load`, async ({
      page,
    }) => {
      await page.emulateMedia({
        colorScheme: theme === 'dark' ? 'light' : 'dark',
      });
      await page.addInitScript((saved) => {
        localStorage.setItem('thinkink-theme', saved);
      }, theme);
      let releaseModules!: () => void;
      const modulesReady = new Promise<void>((resolve) => {
        releaseModules = resolve;
      });
      await page.route('**/assets/*.js', async (route) => {
        await modulesReady;
        await route.continue();
      });
      await page.goto(path, { waitUntil: 'commit' });
      try {
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
          'content',
          theme === 'dark' ? '#131415' : '#fafafa',
        );
        await expect(
          page.locator('head script[type="module"]'),
        ).toHaveAttribute('blocking', 'render');
        // The early theme must not depend on the React/mission module executing.
        if (path === '/') await expect(page.locator('#root')).toBeEmpty();
        else
          await expect(page.locator('h1')).toContainText('Shared attention.');
      } finally {
        releaseModules();
      }
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const headerColor =
        theme === 'dark' ? 'rgb(19, 20, 21)' : 'rgb(250, 250, 250)';
      await expect(page.locator('html')).toHaveCSS(
        'background-color',
        headerColor,
      );
      await expect(page.locator('.site-header')).toHaveCSS(
        'background-color',
        headerColor,
      );
      await page
        .getByRole('button', {
          name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        })
        .click();
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
        'content',
        theme === 'dark' ? '#fafafa' : '#131415',
      );
    });
  }
}

test('system appearance still boots when theme storage is unavailable', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  for (const path of ['/', '/mission/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Switch to light theme' }),
    ).toBeVisible();
  }
});
