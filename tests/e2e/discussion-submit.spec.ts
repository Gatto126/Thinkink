import { expect, test } from '@playwright/test';
import type { CommentList } from '@thinkink/shared/contracts';

const id = 'cc000000-0000-4000-8000-000000000001';

test('comment submission has distinct pending and empty states and retains failed drafts', async ({
  page,
}) => {
  const items: CommentList['items'] = [];
  let attempts = 0;
  let finishPost: (() => void) | undefined;
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id,
          email: 'reader@example.test',
          profile: {
            username: 'reader',
            avatar: null,
            createdAt: '2026-09-20T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        title: 'Comment interaction fixture',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  await page.route(`**/api/topics/${id}/comments?*`, (route) =>
    route.fulfill({ json: { items, hasMore: false, total: items.length } }),
  );
  await page.route('**/api/comments/*', (route) => {
    expect(route.request().method()).toBe('DELETE');
    items.splice(0);
    return route.fulfill({ json: { deleted: true } });
  });
  await page.route(`**/api/topics/${id}/comments`, async (route) => {
    expect(route.request().method()).toBe('POST');
    attempts++;
    await new Promise<void>((resolve) => {
      finishPost = resolve;
    });
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
      });
      return;
    }
    const value = route.request().postDataJSON();
    items.push({
      id: value.id,
      body: value.body,
      parentId: null,
      replyTo: null,
      username: 'reader',
      avatar: null,
      createdAt: '2026-09-20T10:00:00Z',
      canDelete: true,
    });
    await route.fulfill({ json: { id: value.id } });
  });
  await page.goto(`/topics/${id}#discussion`);
  const input = page.getByLabel('Add your perspective');
  const button = page.locator(
    '.comment-form button[type="submit"], .comment-form .pill-button',
  );
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(button).toHaveCSS('cursor', 'default');
  const emptyBackground = await button.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await input.fill('A perspective worth sharing.');
  await expect(button).toBeEnabled();
  expect(
    await button.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe(emptyBackground);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await button.click();
    await expect(button).toHaveText('Posting…');
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveCSS('cursor', 'wait');
    await expect(input).toBeDisabled();
    await expect.poll(() => attempts).toBe(attempt);
    finishPost!();
    await expect(button).toHaveText('Post comment');
    await expect(button).toHaveAttribute('aria-busy', 'false');
    if (attempt === 1) {
      await expect(input).toHaveValue('A perspective worth sharing.');
      await expect(button).toBeEnabled();
      await expect(
        page.getByText('Please try again.', { exact: true }),
      ).toBeVisible();
    }
  }
  await expect(page.locator('.comment-body')).toHaveText(
    'A perspective worth sharing.',
  );
  await expect(input).toHaveValue('');
  await expect(input).toBeEnabled();
  await expect(button).toBeDisabled();
  await expect(button).toHaveCSS('cursor', 'default');
  await expect(button).toHaveCSS('background-color', emptyBackground);
  await expect(page.getByText('Comment posted.', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('Please try again.', { exact: true }),
  ).toHaveCount(0);
  await input.fill('Another thought.');
  await expect(button).toBeEnabled();
  expect(attempts).toBe(2);
  await page.clock.install();
  await page.getByLabel('Comment options by reader').click();
  await page.getByRole('button', { name: 'Delete comment by reader' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(
    page.getByText('Comment deleted.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.comment-body')).toHaveCount(0);
  await page.clock.fastForward(5100);
  await expect(page.getByText('Comment deleted.', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('Make room for another perspective.', { exact: true }),
  ).toHaveCount(0);
});
