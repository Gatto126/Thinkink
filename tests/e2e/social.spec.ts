import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

const topicId = 'fd100000-0000-4000-8000-000000000001';
const commentId = 'fd200000-0000-4000-8000-000000000001';
const topic = {
  id: topicId,
  title: 'Stable topic',
  visits: 12,
  commentCount: 3,
  summary: null,
  summaryCheckedAt: null,
  news: [],
  newsCheckedAt: null,
  newsRevision: 0,
};
const comment = {
  id: commentId,
  body: 'An opinion',
  createdAt: '2026-09-20T10:00:00Z',
  username: 'reader',
  avatar: null,
  parentId: null,
  replyTo: null,
  canDelete: false,
  liked: false,
  likeCount: 5,
};
const user = {
  id: topicId,
  email: 'reader@example.test',
  profile: {
    username: 'reader',
    avatar: null,
    createdAt: '2026-09-20T10:00:00Z',
  },
};

test('topic counters are stable while comments and account activity load', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: false, user: null } }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({ json: topic }),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/topics/${topicId}/comments?*`, async (r) => {
    await gate;
    await r.fulfill({ json: { items: [comment], hasMore: false, total: 3 } });
  });
  await page.route(`**/api/topics/${topicId}/social`, async (r) => {
    await gate;
    await r.fulfill({ json: { visits: 12, commentCount: 3, favorite: false } });
  });
  try {
    await page.goto(`/topics/${topicId}`);
    const counter = page.getByRole('link', {
      name: 'Go to comments (3)',
      exact: true,
    });
    await expect(counter).toHaveText('3');
    await expect(page.getByLabel('12 visits', { exact: true })).toHaveText(
      '12',
    );
    const before = await counter.boundingBox();
    release();
    await expect(page.locator('.comment-body')).toHaveText('An opinion');
    const after = await counter.boundingBox();
    expect(Math.abs(before!.x - after!.x)).toBeLessThan(1);
    expect(before!.width).toBe(after!.width);
    await expect(counter).toHaveText('3');
  } finally {
    release();
  }
});

test('failed likes and favorites keep their previous state and allow another attempt', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { available: true, localSignup: false, user } }),
  );
  await page.route('**/api/notifications?*', (r) =>
    r.fulfill({ json: { items: [], unreadCount: 0, hasMore: false } }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({ json: topic }),
  );
  await page.route(`**/api/topics/${topicId}/comments?*`, (r) =>
    r.fulfill({ json: { items: [comment], total: 1, hasMore: false } }),
  );
  let likeAttempts = 0;
  let favorites = 0;
  await page.route(`**/api/comments/${commentId}/like`, (r) =>
    ++likeAttempts === 1
      ? r.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Like not saved.' } },
        })
      : r.fulfill({ json: { id: commentId, liked: true, likeCount: 6 } }),
  );
  await page.route(`**/api/topics/${topicId}/social`, (r) => {
    if (r.request().method() === 'PUT' && ++favorites === 1)
      return r.fulfill({
        status: 503,
        json: {
          error: { code: 'UNAVAILABLE', message: 'Favorite not saved.' },
        },
      });
    return r.fulfill({
      json: { visits: 12, commentCount: 1, favorite: favorites > 1 },
    });
  });
  await page.goto(`/topics/${topicId}#discussion`);
  await page.getByRole('button', { name: 'Like comment', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Like not saved.');
  await expect(
    page.getByRole('button', { name: 'Like comment', exact: true }),
  ).toHaveText('5');
  await page.getByRole('button', { name: 'Like comment', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unlike comment', exact: true }),
  ).toHaveText('6');
  await page
    .getByRole('button', { name: 'Add to favorites', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Favorite not saved.');
  await expect(
    page.getByRole('button', { name: 'Add to favorites', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page
    .getByRole('button', { name: 'Add to favorites', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Remove from favorites', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('likes on comments and replies and avatar favorites persist against the local database', async ({
  page,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.THINKINK_LOCAL_AUTH_TESTS !== '1',
    'Requires local database',
  );
  test.setTimeout(60000);
  const health = await (await request.get('/api/health')).json();
  expect(health.contentProvidersEnabled).toBe(false);
  const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
  expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  const adminHeaders = {
    apikey: config.SUPABASE_SECRET_KEY!,
    Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
  };
  const origin = { Origin: baseURL! };
  const suffix = randomUUID().slice(0, 8);
  let userId = '';
  let id = '';
  try {
    const signup = await page.request.post('/api/auth/signup', {
      headers: origin,
      data: {
        email: `social-${suffix}@example.test`,
        password: `Social-${randomUUID()}`,
        username: `social_${suffix}`,
        invitation: config.SIGNUP_INVITE_CODE,
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    const create = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `Social ${suffix}` },
    });
    expect(create.ok()).toBe(true);
    id = (await create.json()).id;
    const rootId = randomUUID(),
      replyId = randomUUID();
    for (const [cid, parentId, body] of [
      [rootId, null, 'Saved opinion'],
      [replyId, rootId, 'Saved response'],
    ] as const)
      expect(
        (
          await page.request.post(`/api/topics/${id}/comments`, {
            headers: origin,
            data: { id: cid, parentId, body },
          })
        ).ok(),
      ).toBe(true);
    await page.goto(`/topics/${id}`);
    await expect(
      page.getByRole('link', { name: 'Go to comments (2)', exact: true }),
    ).toHaveText('2');
    await page
      .locator(`#comment-${rootId}`)
      .getByRole('button', { name: 'Like comment', exact: true })
      .click();
    await expect(
      page
        .locator(`#comment-${rootId}`)
        .getByRole('button', { name: 'Unlike comment', exact: true }),
    ).toHaveText('1');
    await page.getByRole('button', { name: 'Show 1 reply' }).click();
    await page
      .locator(`#comment-${replyId}`)
      .getByRole('button', { name: 'Like comment', exact: true })
      .click();
    await expect(
      page
        .locator(`#comment-${replyId}`)
        .getByRole('button', { name: 'Unlike comment', exact: true }),
    ).toHaveText('1');
    await page
      .getByRole('button', { name: 'Add to favorites', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Remove from favorites', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(
      page
        .locator(`#comment-${rootId}`)
        .getByRole('button', { name: 'Unlike comment', exact: true }),
    ).toHaveText('1');
    await expect(
      page.getByRole('button', { name: 'Remove from favorites', exact: true }),
    ).toBeEnabled();
    const anonymous = await (
      await request.get(`/api/topics/${id}/comments?threaded=true`)
    ).json();
    expect(anonymous.items[0].likeCount).toBe(1);
    expect(anonymous.items[0].liked).toBe(false);
    await page
      .getByRole('button', { name: 'Account menu', exact: true })
      .click();
    await page.getByRole('link', { name: 'Favorites', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Favorites', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: `Social ${suffix}`, exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Remove from favorites', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Add to favorites', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await page
      .locator(`#comment-${rootId}`)
      .getByRole('button', { name: 'Unlike comment', exact: true })
      .click();
    await expect(
      page
        .locator(`#comment-${rootId}`)
        .getByRole('button', { name: 'Like comment', exact: true }),
    ).toHaveText('0');
    await page.goto('/favorites');
    await expect(page.getByText('No saved topics yet.')).toBeVisible();
  } finally {
    if (id)
      await request.delete(
        `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${id}`,
        { headers: adminHeaders },
      );
    if (userId)
      await request.delete(
        `${config.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
        { headers: adminHeaders },
      );
  }
});

test('card favorites stay synchronized across home sections without opening the topic', async ({
  page,
}) => {
  let signedIn = true;
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: signedIn ? user : null,
      },
    }),
  );
  const card = {
    id: topicId,
    title: topic.title,
    createdAt: '2026-09-20T10:00:00Z',
    excerpt: 'A topic to save',
    visits: 12,
    commentCount: 3,
  };
  await page.route('**/api/home', (r) =>
    r.fulfill({ json: { latest: [card], mostVisited: [card] } }),
  );
  await page.route('**/api/notifications?*', (r) =>
    r.fulfill({ json: { items: [], unreadCount: 0, hasMore: false } }),
  );
  let favorite = false,
    writes = 0;
  await page.route(`**/api/topics/${topicId}/social`, (r) => {
    if (r.request().method() === 'PUT') {
      writes++;
      if (writes === 1)
        return r.fulfill({
          status: 503,
          json: {
            error: { code: 'UNAVAILABLE', message: 'Please try again.' },
          },
        });
      favorite = r.request().postDataJSON().selected;
    }
    return r.fulfill({ json: { visits: 12, commentCount: 3, favorite } });
  });
  await page.goto('/');
  const stars = page.getByRole('button', {
    name: 'Add to favorites',
    exact: true,
  });
  await expect(stars).toHaveCount(2);
  await expect(stars.first()).toBeEnabled();
  await stars.first().click();
  await expect(page.getByRole('alert')).toContainText('Please try again.');
  await expect(stars).toHaveCount(2);
  await stars.first().click();
  await expect(
    page.getByRole('button', { name: 'Remove from favorites', exact: true }),
  ).toHaveCount(2);
  await expect(page).toHaveURL(/\/$/);
  expect(writes).toBe(2);
  await page
    .getByRole('button', { name: 'Remove from favorites', exact: true })
    .last()
    .click();
  await expect(stars).toHaveCount(2);
  expect(favorite).toBe(false);
  expect(await page.locator('.topic-list a button').count()).toBe(0);
  signedIn = false;
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Log in to save favorites', exact: true }),
  ).toHaveCount(2);
  await expect(page.locator('.favorite-toggle.is-selected')).toHaveCount(0);
});
