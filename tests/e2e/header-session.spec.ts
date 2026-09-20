import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/notifications?*', (route) =>
    route.fulfill({ json: { items: [], unreadCount: 0, hasMore: false } }),
  );
});

const signedIn = {
  available: true,
  localSignup: false,
  user: {
    id: '7e225d51-cbc2-4db4-a07c-105c1f881913',
    email: 'header-test@example.test',
    profile: {
      username: 'header_test',
      avatar: { id: 'iris', label: 'Iris', src: '/avatars/iris.svg' },
      createdAt: '2026-09-20T10:00:00Z',
    },
  },
};
const signedOut = { user: null, available: true, localSignup: false };

test('header keeps its avatar across navigation while the server session is pending', async ({
  page,
}) => {
  // Observe every DOM update, not only the final state after the request.
  await page.addInitScript(() => {
    const flashes: string[] = [];
    Object.assign(window, { headerSignInFlashes: flashes });
    new MutationObserver(() => {
      if (document.querySelector('.header-account a[href="/login"]'))
        flashes.push(location.pathname);
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  let release = () => {};
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/session', async (route) => {
    await gate;
    await route.fulfill({ json: signedIn });
  });
  await page.route('**/api/avatars', (route) =>
    route.fulfill({
      json: { avatars: [signedIn.user.profile.avatar] },
    }),
  );
  try {
    await page.goto('/');
    const control = page.locator('.header-account');
    await expect(control).toHaveAttribute('aria-busy', 'true');
    await expect(control.getByRole('link')).toHaveCount(0);
    const width = (await control.boundingBox())!.width;
    release();
    await expect(control).toHaveAttribute('aria-busy', 'false');
    await expect(control.locator('img')).toHaveAttribute(
      'src',
      '/avatars/iris.svg',
    );

    for (const destination of ['Mission', 'Settings', 'Thinkink home']) {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (destination === 'Settings')
        await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('link', { name: destination, exact: true }).click();
      await expect(control.locator('img')).toHaveAttribute(
        'src',
        '/avatars/iris.svg',
      );
      expect((await control.boundingBox())!.width).toBe(width);
      if (destination === 'Settings') {
        // The visual preview must not expose cached account details.
        await expect(page.getByRole('status')).toHaveText(
          'Loading your account…',
        );
        await expect(
          page.getByText(signedIn.user.email, { exact: true }),
        ).toHaveCount(0);
      }
      release();
      await expect(control).toHaveAttribute('aria-busy', 'false');
      expect(
        await page.evaluate(() => Reflect.get(window, 'headerSignInFlashes')),
      ).toEqual([]);
    }
    // Only a visual hint is persisted, not the account or its credentials.
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('thinkink-account-preview-v1')!),
      ),
    ).toEqual({ signedIn: true, avatar: signedIn.user.profile.avatar });
  } finally {
    release();
  }
});

test('expired sessions discard the avatar preview without granting access to account details', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: signedIn }),
  );
  await page.goto('/');
  await expect(page.locator('.header-account')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/session', async (route) => {
    await gate;
    await route.fulfill({ json: signedOut });
  });
  try {
    await page.goto('/account');
    await expect(page.getByRole('status')).toHaveText('Loading your account…');
    await expect(
      page.getByText(signedIn.user.email, { exact: true }),
    ).toHaveCount(0);
    release();
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.locator('.header-account').getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Account menu' }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Mission' }).click();
    await expect(
      page.locator('.header-account').getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('thinkink-account-preview-v1')!),
      ),
    ).toEqual({ signedIn: false });
  } finally {
    release();
  }
});

for (const storage of ['unavailable', 'invalid'] as const) {
  test(`account navigation works with ${storage} preview storage`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      if (mode === 'unavailable') {
        for (const method of ['getItem', 'setItem'])
          Object.defineProperty(Storage.prototype, method, {
            value: () => {
              throw new DOMException('Storage is disabled', 'SecurityError');
            },
          });
      } else {
        sessionStorage.setItem(
          'thinkink-account-preview-v1',
          JSON.stringify({
            signedIn: true,
            avatar: {
              id: 'iris',
              label: 'Iris',
              src: 'https://example.test/untrusted.svg',
            },
          }),
        );
      }
    }, storage);
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({ json: signedIn }),
    );
    for (const path of ['/', '/mission/']) {
      await page.goto(path);
      await expect(page.locator('.header-account')).toHaveAttribute(
        'aria-busy',
        'false',
      );
      await expect(
        page.getByRole('button', { name: 'Account menu' }).locator('img'),
      ).toHaveAttribute('src', '/avatars/iris.svg');
    }
  });
}

test('avatar menu supports dismissal, settings and logout', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: signedIn }),
  );
  await page.route('**/api/avatars', (route) =>
    route.fulfill({ json: { avatars: [signedIn.user.profile.avatar] } }),
  );
  let attempts = 0;
  await page.route('**/api/auth/logout', (route) => {
    expect(route.request().method()).toBe('POST');
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: {
            error: { code: 'UNAVAILABLE', message: 'Please try again.' },
          },
        })
      : route.fulfill({ json: signedOut });
  });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Account menu' });
  const settings = page.getByRole('link', { name: 'Settings', exact: true });
  await expect(settings).toBeHidden();
  await trigger.click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(settings).toBeHidden();
  await trigger.click();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(settings).toBeHidden();
  await trigger.click();
  await settings.click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(settings).toBeHidden();
  await page.goto('/');
  await trigger.click();
  const logout = page
    .locator('.account-menu-panel')
    .getByRole('button', { name: 'Log out', exact: true });
  await logout.click();
  await expect(
    page.locator('.account-menu-panel').getByRole('alert'),
  ).toHaveText('Please try again.');
  await logout.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await expect(trigger).toHaveCount(0);
  expect(attempts).toBe(2);
});

for (const isModerator of [false, true]) {
  test(`avatar menu admin access: ${isModerator}`, async ({ page }) => {
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        json: {
          ...signedIn,
          user: { ...signedIn.user, isModerator },
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const admin = page.getByRole('link', { name: 'Admin console' });
    if (isModerator) {
      await expect(admin).toHaveAttribute('href', '/moderation');
      await admin.click();
      await expect(page).toHaveURL(/\/moderation$/);
    } else await expect(admin).toHaveCount(0);
  });
}
