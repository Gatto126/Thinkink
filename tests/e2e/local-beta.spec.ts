import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('beta quota, comments and daily visit deduplication work against the local database', async ({
  page,
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
  const ids: string[] = [];
  let userId = '';
  const origin = { Origin: baseURL! };
  try {
    const signup = await page.request.post('/api/auth/signup', {
      headers: origin,
      data: {
        email: `beta-${suffix}@example.test`,
        password: `Beta-${randomUUID()}`,
        username: `beta_${suffix}`,
        invitation: config.SIGNUP_INVITE_CODE,
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    for (let n = 0; n < 5; n++) {
      const created = await page.request.post('/api/topics', {
        headers: origin,
        data: { title: `Beta ${suffix} topic ${n}` },
      });
      expect(created.ok()).toBe(true);
      ids.push((await created.json()).id);
    }
    const denied = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `Beta ${suffix} sixth` },
    });
    expect(denied.status()).toBe(429);
    expect((await denied.json()).error.code).toBe('TOPIC_DAILY_LIMIT');
    const duplicate = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `Beta ${suffix} topic 0` },
    });
    expect((await duplicate.json()).id).toBe(ids[0]);
    await page.goto(`/topics/${ids[0]}`);
    await page
      .getByLabel('Add your perspective')
      .fill('A real saved beta comment.');
    await page
      .getByRole('button', { name: 'Post comment', exact: true })
      .click();
    await expect(page.locator('.comment-body')).toHaveText(
      'A real saved beta comment.',
    );
    await page.reload();
    await expect(page.locator('.comment-body')).toHaveText(
      'A real saved beta comment.',
    );
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByLabel('Your reply').fill('A saved reply.');
    await page.getByRole('button', { name: 'Post reply', exact: true }).click();
    await expect(page.locator('.comment-body')).toHaveCount(2);
    await expect(
      page
        .getByRole('region', { name: `Replies to beta_${suffix}` })
        .locator('.comment-body'),
    ).toHaveText('A saved reply.');
    const publicComments = await (
      await request.get(`/api/topics/${ids[0]}/comments`)
    ).json();
    expect(publicComments.total).toBe(2);
    expect(
      publicComments.items.every((v: { canDelete: boolean }) => !v.canDelete),
    ).toBe(true);
    const guestPost = await request.post(`/api/topics/${ids[0]}/comments`, {
      headers: origin,
      data: { id: randomUUID(), body: 'Denied' },
    });
    expect(guestPost.status()).toBe(401);
    const reader = await page.request.get(`/api/topics/${ids[0]}`);
    expect(reader.ok()).toBe(true);
    for (let n = 0; n < 3; n++)
      expect(
        (
          await page.request.post(`/api/topics/${ids[0]}/views`, {
            headers: origin,
          })
        ).status(),
      ).toBe(204);
    // Existing local topics can outrank this fixture in the top-three list.
    // Read this topic directly to verify daily visit deduplication in isolation.
    const activity = await (
      await request.get(`/api/topics/${ids[0]}/social`)
    ).json();
    expect(activity.visits).toBe(1);
    await page.getByLabel(`Comment options by beta_${suffix}`).first().click();
    await page
      .getByRole('button', { name: `Delete comment by beta_${suffix}` })
      .first()
      .click();
    await page
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(page.locator('.comment-body')).toHaveCount(1);
    const deleted = await page.request.delete(`/api/topics/${ids[0]}`, {
      headers: origin,
      data: { confirmation: true },
    });
    expect(deleted.ok()).toBe(true);
    const afterDelete = await page.request.post('/api/topics', {
      headers: origin,
      data: { title: `Beta ${suffix} replacement` },
    });
    expect(afterDelete.status()).toBe(429);
    expect((await request.get(`/api/topics/${ids[0]}/comments`)).status()).toBe(
      404,
    );
  } finally {
    for (const id of ids)
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
