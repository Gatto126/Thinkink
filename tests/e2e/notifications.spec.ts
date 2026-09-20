import { expect, test } from '@playwright/test';
const topicId = 'fb000000-0000-4000-8000-000000000001';
const rootId = 'fb000000-0000-4000-8000-000000000002';
const targetId = 'fb000000-0000-4000-8000-000000000003';
const notificationId = 'fb000000-0000-4000-8000-000000000004';
const at = '2026-09-20T10:00:00Z';

for (const kind of ['reply', 'comment_like'] as const) {
  test(`${kind} notification links open older roots and later replies, including a second visit on the same topic`, async ({
    page,
  }) => {
    await page.route('**/api/auth/session', (r) =>
      r.fulfill({
        json: {
          available: true,
          localSignup: false,
          user: {
            id: topicId,
            email: 'reader@example.test',
            profile: { username: 'reader', avatar: null, createdAt: at },
          },
        },
      }),
    );
    await page.route(`**/api/topics/${topicId}`, (r) =>
      r.fulfill({
        json: {
          id: topicId,
          title: 'older conversations',
          summary: null,
          summaryCheckedAt: null,
          news: [],
          newsCheckedAt: null,
          newsRevision: 0,
        },
      }),
    );
    const root = {
      id: rootId,
      body: 'An older conversation.',
      createdAt: at,
      username: 'reader',
      avatar: null,
      parentId: null,
      replyTo: null,
      canDelete: false,
      replyCount: 51,
    };
    const target = {
      ...root,
      id: targetId,
      body: 'The reply from a later page.',
      parentId: rootId,
      replyTo: 'reader',
      replyCount: 0,
    };
    await page.route(`**/api/topics/${topicId}/comments?*`, (r) => {
      const url = new URL(r.request().url());
      if (url.searchParams.has('locate'))
        return r.fulfill({ json: { rootId, rootOffset: 50, replyOffset: 50 } });
      const isTargetPage = url.searchParams.get('offset') === '50';
      return r.fulfill({
        json: {
          items: isTargetPage
            ? [url.searchParams.has('thread') ? target : root]
            : [],
          total: 102,
          hasMore: false,
        },
      });
    });
    let read = false;
    await page.route('**/api/notifications?*', (r) =>
      r.fulfill({
        json: {
          items: [
            {
              id: notificationId,
              kind,
              createdAt: at,
              read,
              username: 'maria',
              avatar: '/avatars/sunrise.svg',
              topicId,
              topicTitle: 'older conversations',
              commentId: targetId,
              preview: target.body,
            },
          ],
          unreadCount: read ? 0 : 1,
          hasMore: false,
        },
      }),
    );
    await page.route('**/api/notifications/read', (r) => {
      read = true;
      return r.fulfill({ json: { read: true } });
    });
    await page.goto(`/topics/${topicId}`);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.locator('.notification-item').click();
    await expect(page.locator(`#comment-${targetId}`)).toBeFocused();
    await expect(page.locator(`#comment-${targetId}`)).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Earlier replies' }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Newer comments' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Hide replies' }).click();
    await expect(page.locator(`#comment-${targetId}`)).toBeHidden();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.locator('.notification-item').click();
    await expect(page.locator(`#comment-${targetId}`)).toBeFocused();
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/thinkink-notification-target-${test.info().project.name}.png`,
    });
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.locator('.notification-item')).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: `/tmp/thinkink-notification-panel-${test.info().project.name}.png`,
    });
  });
}

test('failed read attempts retain the badge and can be retried', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: topicId,
          email: 'reader@example.test',
          profile: { username: 'reader', avatar: null, createdAt: at },
        },
      },
    }),
  );
  let read = false;
  await page.route('**/api/notifications?*', (r) =>
    r.fulfill({
      json: { items: [], unreadCount: read ? 0 : 2, hasMore: false },
    }),
  );
  let attempts = 0;
  await page.route('**/api/notifications/read', (r) => {
    expect(r.request().postDataJSON()).toEqual({ id: null });
    if (++attempts === 1)
      return r.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
      });
    read = true;
    return r.fulfill({ json: { read: true } });
  });
  await page.goto('/');
  await expect(page.locator('.notification-badge')).toHaveText('2');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(
    page.locator('.notification-inbox').getByRole('alert'),
  ).toHaveText('Please try again.');
  await expect(page.locator('.notification-badge')).toHaveText('2');
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.locator('.notification-badge')).toHaveCount(0);
});

test('a received like updates the badge and inbox on the next live poll without reloading', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: topicId,
          email: 'reader@example.test',
          profile: { username: 'reader', avatar: null, createdAt: at },
        },
      },
    }),
  );
  await page.route('**/api/home', (r) =>
    r.fulfill({ json: { latest: [], mostVisited: [] } }),
  );
  let received = false,
    reads = 0;
  await page.route('**/api/notifications?*', (r) => {
    reads++;
    return r.fulfill({
      json: {
        items: received
          ? [
              {
                id: notificationId,
                kind: 'comment_like',
                createdAt: at,
                read: false,
                username: 'maria',
                avatar: null,
                topicId,
                topicTitle: 'Like updates',
                commentId: targetId,
                preview: 'My reply',
              },
            ]
          : [],
        unreadCount: received ? 1 : 0,
        hasMore: false,
      },
    });
  });
  await page.goto('/');
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('.notification-badge')).toHaveCount(0);
  received = true;
  await page.clock.fastForward(15001);
  await expect(page.locator('.notification-badge')).toHaveText('1');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('.notification-item')).toContainText(
    '@maria liked your comment',
  );
  await expect(page.locator('.notification-item')).toHaveAttribute(
    'href',
    `/topics/${topicId}#comment-${targetId}`,
  );
});
