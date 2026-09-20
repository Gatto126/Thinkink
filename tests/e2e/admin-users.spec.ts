import { expect, test } from '@playwright/test';

const id = 'f7300000-0000-4000-8000-000000000001';
const adminId = 'f7300000-0000-4000-8000-000000000002';
const member = {
  id,
  username: 'registered_member',
  email: 'member@example.test',
  createdAt: '2026-09-20T10:00:00Z',
  isModerator: false,
  isCurrentUser: false,
  topicCount: 3,
  commentCount: 8,
};

test('admin can search and page through users, cancel deletion and retry a failed deletion', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: adminId,
          isModerator: true,
          email: 'admin@example.test',
          profile: {
            username: 'test_admin',
            avatar: null,
            createdAt: member.createdAt,
          },
        },
      },
    }),
  );
  await page.route('**/api/moderation/topics?*', (r) =>
    r.fulfill({ json: { items: [], hasMore: false } }),
  );
  await page.route('**/api/moderation/budget', (r) => r.fulfill({ json: {} }));
  let deleted = false;
  let reads = 0;
  await page.route('**/api/moderation/users?*', (r) => {
    reads++;
    if (reads === 1)
      return r.fulfill({
        status: 503,
        json: {
          error: {
            code: 'CONTENT_UNAVAILABLE',
            message: 'User list unavailable.',
          },
        },
      });
    const url = new URL(r.request().url());
    const second = url.searchParams.get('offset') === '50';
    return r.fulfill({
      json: {
        items: deleted
          ? []
          : [
              second
                ? {
                    ...member,
                    id: adminId,
                    username: 'test_admin',
                    isCurrentUser: true,
                    isModerator: true,
                  }
                : member,
            ],
        hasMore: !deleted && !second,
      },
    });
  });
  let attempts = 0;
  await page.route(`**/api/moderation/users/${id}`, (r) => {
    expect(r.request().method()).toBe('DELETE');
    expect(r.request().postDataJSON()).toEqual({ confirmation: true });
    attempts++;
    if (attempts === 1)
      return r.fulfill({
        status: 503,
        json: {
          error: {
            code: 'CONTENT_UNAVAILABLE',
            message: 'Deletion unavailable. Please try again.',
          },
        },
      });
    deleted = true;
    return r.fulfill({ json: { deleted: true } });
  });
  await page.goto('/moderation');
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  const users = page.getByRole('region', { name: 'Manage users' });
  await expect(users.getByRole('alert')).toHaveText('User list unavailable.');
  await users.getByRole('button', { name: 'Try again' }).click();
  await expect(users).toContainText('3 topics · 8 comments');
  await users.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(users).toContainText('Page 2');
  await expect(users).toContainText('Your account');
  await expect(users.getByRole('button', { name: /Delete user:/ })).toHaveCount(
    0,
  );
  await users
    .getByRole('textbox', { name: 'Search users' })
    .fill('member@example.test');
  const search = page.waitForRequest(
    (r) =>
      r.url().includes('/api/moderation/users?') &&
      new URL(r.url()).searchParams.get('q') === 'member@example.test',
  );
  await users
    .getByRole('button', { name: 'Search users', exact: true })
    .click();
  expect(new URL((await search).url()).searchParams.get('offset')).toBe('0');
  const trash = users.getByRole('button', {
    name: 'Delete user: registered_member',
    exact: true,
  });
  await trash.click();
  await users.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(attempts).toBe(0);
  await expect(trash).toBeFocused();
  await trash.click();
  await users.getByRole('button', { name: 'Delete user permanently' }).click();
  await expect(users.getByRole('alert')).toHaveText(
    'Deletion unavailable. Please try again.',
  );
  await expect(trash).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem('thinkink:content:v1:topic:stale', '{}'),
  );
  await users.getByRole('button', { name: 'Delete user permanently' }).click();
  await expect(users).toContainText('User, their topics and comments deleted.');
  await expect(users).toContainText('No users found.');
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('thinkink:content:v1:topic:stale'),
    ),
  ).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
