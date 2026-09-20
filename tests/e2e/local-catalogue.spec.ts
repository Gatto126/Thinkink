import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('local catalogue persists a created topic and resolves concurrent duplicates', async ({
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
    'Never run catalogue creation tests against a preview with live providers enabled.',
  );
  const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
  expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 14);
  const title = `Ocean-policy-${suffix}`;
  const email = `catalogue-${suffix}@example.test`;
  const adminHeaders = {
    apikey: config.SUPABASE_SECRET_KEY!,
    Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
  };
  let userId: string | undefined;
  let topicId: string | undefined;
  try {
    const signup = await page.request.post('/api/auth/signup', {
      headers: { Origin: baseURL! },
      data: {
        email,
        password: `Local-only-${randomUUID()}`,
        username: `catalogue_${suffix}`,
        invitation: config.SIGNUP_INVITE_CODE,
      },
    });
    expect(signup.ok()).toBe(true);
    userId = (await signup.json()).user.id;
    expect(
      (
        await request.get(`/api/topics/resolve?q=${encodeURIComponent(title)}`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post('/api/topics', {
          headers: { Origin: baseURL! },
          data: { title },
        })
      ).status(),
    ).toBe(401);
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Search a topic' }).fill(title);
    await page
      .getByRole('button', { name: 'Start this topic', exact: true })
      .click();
    await expect(page).toHaveURL(/\/topics\/[0-9a-f-]+$/);
    topicId = new URL(page.url()).pathname.split('/').at(-1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(
      page.getByText('This topic is saved.', { exact: false }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const duplicates = await Promise.all(
      Array.from({ length: 4 }, () =>
        page.request.post('/api/topics', {
          headers: { Origin: baseURL! },
          data: { title: `  ${title.toUpperCase().replaceAll(' ', '   ')}  ` },
        }),
      ),
    );
    for (const response of duplicates) {
      expect(response.ok()).toBe(true);
      expect((await response.json()).id).toBe(topicId);
    }
    expect(
      (
        await page.request.post('/api/topics', {
          headers: { Origin: 'https://foreign.example' },
          data: { title },
        })
      ).status(),
    ).toBe(403);
    const publicTopic = await (
      await request.get(`/api/topics/${topicId}`)
    ).json();
    expect(publicTopic).toMatchObject({
      id: topicId,
      title,
      summary: null,
      news: [],
    });
    expect(publicTopic).not.toHaveProperty('created_by');
    await page.getByRole('link', { name: 'All topics', exact: true }).click();
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/topics/${topicId}`);
    const latest = (await (await request.get('/api/home')).json()).latest;
    expect(
      latest.filter((row: { id: string }) => row.id === topicId),
    ).toHaveLength(1);
    const suggestions = await request.get(`/api/topics/search?q=${suffix}`);
    expect(suggestions.ok()).toBe(true);
    const suggested = (await suggestions.json()).topics;
    expect(suggested).toEqual([
      expect.objectContaining({ id: topicId, title }),
    ]);
    expect(suggested[0]).not.toHaveProperty('created_by');
    const phrase = await request.get(
      `/api/topics/search?q=${encodeURIComponent(`war in ${suffix}`)}`,
    );
    expect((await phrase.json()).topics).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: topicId, title })]),
    );
    // Account removal retains the shared topic, including its public lookup.
    expect(
      (
        await request.delete(
          `${config.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
          { headers: adminHeaders },
        )
      ).ok(),
    ).toBe(true);
    userId = undefined;
    expect(
      (
        await (
          await request.get(
            `/api/topics/resolve?q=${encodeURIComponent(title.toLowerCase())}`,
          )
        ).json()
      ).id,
    ).toBe(topicId);
  } finally {
    // Recover our own ID if a browser assertion failed immediately after creation.
    const rows = await request.get(
      `${config.SUPABASE_URL}/rest/v1/topics?select=id&title=eq.${encodeURIComponent(title)}`,
      { headers: adminHeaders },
    );
    if (rows.ok())
      for (const row of await rows.json())
        expect(
          (
            await request.delete(
              `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${row.id}`,
              { headers: adminHeaders },
            )
          ).ok(),
        ).toBe(true);
    if (userId)
      expect(
        (
          await request.delete(
            `${config.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
            { headers: adminHeaders },
          )
        ).ok(),
      ).toBe(true);
  }
});
