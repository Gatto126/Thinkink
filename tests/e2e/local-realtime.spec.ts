import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('real rooms deliver comments, replies, likes, reconnects and deletion without losing drafts', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.THINKINK_LOCAL_AUTH_TESTS !== '1',
    'Requires local Supabase.',
  );
  test.setTimeout(90000);
  expect(
    (await (await request.get('/api/health')).json()).contentProvidersEnabled,
  ).toBe(false);
  const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
  expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  const suffix = randomUUID().slice(0, 8);
  const origin = { Origin: baseURL! };
  const adminHeaders = {
    apikey: config.SUPABASE_SECRET_KEY!,
    Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
  };
  let userId = '';
  let topicId = '';
  let reader: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const signup = await page.request.post('/api/auth/signup', {
      headers: origin,
      data: {
        email: `room-${suffix}@example.test`,
        username: `room_${suffix}`,
        password: `Room-${randomUUID()}`,
        invitation: config.SIGNUP_INVITE_CODE,
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    const created = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `Room ${suffix}` },
    });
    expect(created.ok()).toBe(true);
    topicId = (await created.json()).id;
    reader = await browser.newContext({
      storageState: await page.context().storageState(),
      baseURL,
    });
    const observer = await reader.newPage();
    let syncMessages = 0;
    observer.on('websocket', (socket) =>
      socket.on('framereceived', (event) => {
        if (String(event.payload).includes('"type":"sync"')) syncMessages++;
      }),
    );
    await observer.goto(`/topics/${topicId}`);
    await expect(observer.locator('[data-live-state]')).toHaveAttribute(
      'data-live-state',
      'connected',
    );
    await observer
      .getByLabel('Add your perspective')
      .fill('Keep this unfinished draft');
    const commentId = randomUUID();
    const post = (id: string, body: string, parentId?: string) =>
      page.request.post(`/api/topics/${topicId}/comments`, {
        headers: origin,
        data: { id, body, parentId: parentId ?? null },
      });
    expect((await post(commentId, 'Arrived over a real room')).ok()).toBe(true);
    await expect(observer.locator('.comment-body')).toHaveText(
      'Arrived over a real room',
    );
    await expect(observer.getByLabel('Add your perspective')).toHaveValue(
      'Keep this unfinished draft',
    );
    expect((await post(commentId, 'Arrived over a real room')).ok()).toBe(true);
    await expect(observer.locator('.comment-body')).toHaveCount(1);
    const replyId = randomUUID();
    expect((await post(replyId, 'Live reply', commentId)).ok()).toBe(true);
    await observer
      .getByRole('button', { name: 'Show 1 reply', exact: true })
      .click();
    await expect(observer.locator('.comment-body')).toHaveCount(2);
    expect(
      (
        await page.request.put(`/api/comments/${replyId}/like`, {
          headers: origin,
          data: { selected: true },
        })
      ).ok(),
    ).toBe(true);
    await expect(
      observer.locator(`#comment-${replyId} .comment-like`),
    ).toContainText('1');
    expect(syncMessages).toBeGreaterThanOrEqual(4);

    // Detach the reader, commit while it cannot receive messages, then reconnect.
    await reader.setOffline(true);
    await observer.goto('about:blank');
    expect((await post(randomUUID(), 'Saved during disconnection')).ok()).toBe(
      true,
    );
    await reader.setOffline(false);
    await observer.goto(`/topics/${topicId}`);
    await expect(observer.locator('[data-live-state]')).toHaveAttribute(
      'data-live-state',
      'connected',
    );
    await expect(observer.locator('.comment-body')).toContainText([
      'Saved during disconnection',
      'Arrived over a real room',
    ]);
    expect(
      (
        await page.request.delete(`/api/comments/${commentId}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).ok(),
    ).toBe(true);
    await expect(observer.locator('.comment-body')).not.toContainText([
      'Arrived over a real room',
    ]);
    await expect(observer.locator('.comment-body')).toContainText([
      'Saved during disconnection',
      'Live reply',
    ]);
    expect(
      (
        await page.request.delete(`/api/topics/${topicId}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).ok(),
    ).toBe(true);
    await expect(observer.getByRole('alert')).toContainText(
      'This topic has been deleted.',
    );
  } finally {
    await reader?.close();
    if (topicId)
      await request.delete(
        `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${topicId}`,
        { headers: adminHeaders },
      );
    if (userId)
      await request.delete(
        `${config.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
        { headers: adminHeaders },
      );
  }
});
