import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('comment and reply notifications persist, open the target and stay private', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.THINKINK_LOCAL_AUTH_TESTS !== '1',
    'Requires local Supabase.',
  );
  const health = await (await request.get('/api/health')).json();
  test.skip(
    health.contentProvidersEnabled !== false,
    'Never create fixtures against live providers.',
  );
  const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
  expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  const adminHeaders = {
    apikey: config.SUPABASE_SECRET_KEY!,
    Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
  };
  const suffix = randomUUID().slice(0, 8);
  const users: string[] = [];
  let topicId = '';
  const origin = { Origin: baseURL! };
  const visitor = await browser.newContext({ baseURL });
  try {
    for (const [api, name] of [
      [page.request, 'owner'],
      [visitor.request, 'visitor'],
    ] as const) {
      const signup = await api.post('/api/auth/signup', {
        headers: origin,
        data: {
          email: `${name}-${suffix}@example.test`,
          password: `Notification-${randomUUID()}`,
          username: `${name}_${suffix}`,
          invitation: config.SIGNUP_INVITE_CODE,
        },
      });
      expect(signup.ok()).toBe(true);
      users.push((await signup.json()).user.id);
    }
    const topic = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `notification ${suffix}` },
    });
    expect(topic.ok()).toBe(true);
    topicId = (await topic.json()).id;
    const commentId = randomUUID();
    const comment = {
      id: commentId,
      body: 'A new perspective for your topic.',
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (
          await visitor.request.post(`/api/topics/${topicId}/comments`, {
            headers: origin,
            data: comment,
          })
        ).status(),
      ).toBe(201);
    }
    let inbox = await (await page.request.get('/api/notifications')).json();
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0].kind).toBe('topic_comment');
    expect(inbox.items[0].topicTitle).toBe(`Notification ${suffix}`);
    const notificationId = inbox.items[0].id;
    await visitor.request.post('/api/notifications/read', {
      headers: origin,
      data: { id: notificationId },
    });
    expect(
      (await (await page.request.get('/api/notifications')).json()).unreadCount,
    ).toBe(1);
    expect((await request.get('/api/notifications')).status()).toBe(401);
    await page.goto(`/topics/${topicId}`);
    await expect(page.locator('.notification-badge')).toHaveText('1');
    await page
      .getByRole('button', { name: 'Account menu', exact: true })
      .click();
    await expect(
      page.getByRole('link', { name: 'Settings', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Log out', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.notification-item')).toContainText(
      comment.body,
    );
    const box = await page.locator('.account-menu-panel').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.locator('.notification-item').click();
    await expect(page).toHaveURL(new RegExp(`#comment-${commentId}$`));
    await expect(page.locator(`#comment-${commentId}`)).toBeFocused();
    await expect(page.locator('.notification-badge')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.notification-badge')).toHaveCount(0);
    const replyId = randomUUID();
    expect(
      (
        await page.request.post(`/api/topics/${topicId}/comments`, {
          headers: origin,
          data: {
            id: replyId,
            parentId: commentId,
            body: 'Thanks for your perspective.',
          },
        })
      ).status(),
    ).toBe(201);
    inbox = await (await visitor.request.get('/api/notifications')).json();
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0].kind).toBe('reply');
    expect(inbox.items[0].commentId).toBe(replyId);
    const visitorPage = await visitor.newPage();
    await visitorPage.goto('/');
    await visitorPage.getByRole('button', { name: 'Account menu' }).click();
    await visitorPage.locator('.notification-item').click();
    await expect(visitorPage.locator(`#comment-${replyId}`)).toBeFocused();
    expect(
      (await (await visitor.request.get('/api/notifications')).json())
        .unreadCount,
    ).toBe(0);
    await visitor.request.delete(`/api/comments/${commentId}`, {
      headers: origin,
      data: { confirmation: true },
    });
    expect(
      (await (await page.request.get('/api/notifications')).json()).items,
    ).toHaveLength(0);
  } finally {
    if (topicId)
      await request.delete(
        `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${topicId}`,
        { headers: adminHeaders },
      );
    for (const id of users)
      await request.delete(`${config.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        headers: adminHeaders,
      });
    await visitor.close();
  }
});
