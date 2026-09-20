import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('owners manage their cards and moderators remove topics and individual comments', async ({
  page,
  request,
  baseURL,
}) => {
  test.skip(
    process.env.THINKINK_LOCAL_AUTH_TESTS !== '1',
    'Requires local Supabase.',
  );
  const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
  expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
  expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const adminHeaders = {
    apikey: config.SUPABASE_SECRET_KEY!,
    Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
  };
  const origin = { Origin: baseURL! };
  const accounts: string[] = [];
  const topics: string[] = [];
  const password = `Local-${randomUUID()}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const moderatorEmail = `moderator-${suffix}@example.test`;
  async function createUser(email: string, username: string) {
    const response = await request.post(
      `${config.SUPABASE_URL}/auth/v1/admin/users`,
      {
        headers: adminHeaders,
        data: {
          email,
          password,
          email_confirm: true,
          user_metadata: { username },
        },
      },
    );
    expect(response.ok()).toBe(true);
    const user = await response.json();
    accounts.push(user.id);
    return user.id as string;
  }
  async function topic(title: string, created_by: string) {
    const response = await request.post(
      `${config.SUPABASE_URL}/rest/v1/topics`,
      {
        headers: { ...adminHeaders, Prefer: 'return=representation' },
        data: { title, created_by },
      },
    );
    expect(response.ok()).toBe(true);
    const row = (await response.json())[0];
    topics.push(row.id);
    return row.id as string;
  }
  async function comment(topic_id: string, body: string, author_id: string) {
    const response = await request.post(
      `${config.SUPABASE_URL}/rest/v1/comments`,
      {
        headers: { ...adminHeaders, Prefer: 'return=representation' },
        data: { topic_id, body, author_id },
      },
    );
    expect(response.ok()).toBe(true);
    return (await response.json())[0].id as string;
  }
  try {
    const owner = await createUser(ownerEmail, `owner_${suffix}`);
    const moderator = await createUser(moderatorEmail, `mod_${suffix}`);
    const title = `Owner conversation ${suffix}`;
    const otherTitle = `Another conversation ${suffix}`;
    const owned = await topic(title, owner);
    const other = await topic(otherTitle, moderator);
    await comment(owned, 'A reply by someone else', moderator);
    const individual = await comment(
      other,
      `Review this comment ${suffix}`,
      owner,
    );
    expect(
      (
        await request.delete(`/api/topics/${owned}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).status(),
    ).toBe(401);
    await page.request.post('/api/auth/login', {
      headers: origin,
      data: { email: ownerEmail, password },
    });
    const ownListing = await (
      await page.request.get('/api/account/topics')
    ).json();
    expect(ownListing.items.map((item: { id: string }) => item.id)).toEqual([
      owned,
    ]);
    expect((await page.request.get('/api/moderation/topics')).status()).toBe(
      403,
    );
    expect((await page.request.get('/api/moderation/users')).status()).toBe(
      403,
    );
    expect(
      (
        await page.request.delete(`/api/moderation/users/${moderator}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete(`/api/topics/${other}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.delete(`/api/topics/${owned}`, {
          headers: origin,
          data: { confirmation: false },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.delete(`/api/topics/${owned}`, {
          headers: { Origin: 'https://foreign.example' },
          data: { confirmation: true },
        })
      ).status(),
    ).toBe(403);
    await page.goto('/account');
    const section = page.getByRole('region', {
      name: 'Your topics',
      exact: true,
    });
    await expect(
      section.getByRole('link', { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole('link', { name: otherTitle, exact: true }),
    ).toHaveCount(0);
    await section
      .getByRole('button', { name: `Delete topic: ${title}`, exact: true })
      .click();
    await section.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await request.get(`/api/topics/${owned}`)).ok()).toBe(true);
    await section
      .getByRole('button', { name: `Delete topic: ${title}`, exact: true })
      .click();
    await section
      .getByRole('button', { name: 'Delete permanently', exact: true })
      .click();
    await expect(section).toContainText('Topic and its comments deleted.');
    await expect(section).toContainText('You haven’t started any topics yet.');
    expect((await request.get(`/api/topics/${owned}`)).status()).toBe(404);
    const remaining = await request.get(
      `${config.SUPABASE_URL}/rest/v1/comments?select=id&topic_id=eq.${owned}`,
      { headers: adminHeaders },
    );
    expect(await remaining.json()).toEqual([]);
    const moderateTitle = `Moderate conversation ${suffix}`;
    const moderate = await topic(moderateTitle, owner);
    await comment(moderate, 'Removed together with the topic', owner);
    expect(
      (
        await request.post(`${config.SUPABASE_URL}/rest/v1/moderators`, {
          headers: adminHeaders,
          data: { user_id: moderator },
        })
      ).ok(),
    ).toBe(true);
    await page.request.post('/api/auth/logout', { headers: origin });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(moderatorEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/moderation');
    const management = page.getByRole('region', { name: 'Manage topics' });
    await management
      .getByRole('button', {
        name: `Delete topic: ${moderateTitle}`,
        exact: true,
      })
      .click();
    await management
      .getByRole('button', { name: 'Delete permanently' })
      .click();
    await expect(
      management.getByRole('link', { name: moderateTitle, exact: true }),
    ).toHaveCount(0);
    expect((await request.get(`/api/topics/${moderate}`)).status()).toBe(404);
    await page.getByRole('button', { name: 'Comments', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Search comments', exact: true })
      .fill(suffix);
    await page
      .getByRole('button', { name: 'Search comments', exact: true })
      .click();
    const comments = page.getByRole('region', { name: 'Manage comments' });
    await comments
      .getByRole('button', {
        name: `Delete comment: ${otherTitle}`,
        exact: true,
      })
      .click();
    await comments.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(comments).toContainText('No content found.');
    const deletedComment = await request.get(
      `${config.SUPABASE_URL}/rest/v1/comments?select=id&id=eq.${individual}`,
      { headers: adminHeaders },
    );
    expect(await deletedComment.json()).toEqual([]);
    expect((await request.get(`/api/topics/${other}`)).ok()).toBe(true);
    const removedTopic = await topic(`Deleted with user ${suffix}`, owner);
    const ownerLogin = await request.post(
      `${config.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY! },
        data: { email: ownerEmail, password },
      },
    );
    expect(ownerLogin.ok()).toBe(true);
    const ownerSession = await ownerLogin.json();
    await comment(removedTopic, 'Another author on deleted topic', moderator);
    const removedComment = await comment(
      other,
      'Deleted author on retained topic',
      owner,
    );
    const retainedComment = await comment(
      other,
      'Retained author on retained topic',
      moderator,
    );
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    const users = page.getByRole('region', { name: 'Manage users' });
    await users
      .getByRole('textbox', { name: 'Search users' })
      .fill(moderatorEmail);
    await users
      .getByRole('button', { name: 'Search users', exact: true })
      .click();
    await expect(users).toContainText('Your account');
    await expect(
      users.getByRole('button', { name: `Delete user: mod_${suffix}` }),
    ).toHaveCount(0);
    expect(
      (
        await page.request.delete(`/api/moderation/users/${moderator}`, {
          headers: origin,
          data: { confirmation: true },
        })
      ).status(),
    ).toBe(400);
    await users.getByRole('textbox', { name: 'Search users' }).fill(ownerEmail);
    await users
      .getByRole('button', { name: 'Search users', exact: true })
      .click();
    await expect(users).toContainText(`owner_${suffix}`);
    await expect(users).toContainText('1 topic · 1 comment');
    const deleteUser = users.getByRole('button', {
      name: `Delete user: owner_${suffix}`,
      exact: true,
    });
    await deleteUser.click();
    await expect(users).toContainText(
      'Comments by other people on their topics will also be removed.',
    );
    await users.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await request.get(`/api/topics/${removedTopic}`)).ok()).toBe(true);
    await deleteUser.click();
    await users
      .getByRole('button', { name: 'Delete user permanently', exact: true })
      .click();
    await expect(users).toContainText(
      'User, their topics and comments deleted.',
    );
    await expect(users).toContainText('No users found.');
    expect(
      (
        await request.get(`${config.SUPABASE_URL}/auth/v1/user`, {
          headers: {
            apikey: config.SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${ownerSession.access_token}`,
          },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post(
          `${config.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
          {
            headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY! },
            data: { refresh_token: ownerSession.refresh_token },
          },
        )
      ).ok(),
    ).toBe(false);
    expect((await request.get(`/api/topics/${removedTopic}`)).status()).toBe(
      404,
    );
    expect((await request.get(`/api/topics/${other}`)).ok()).toBe(true);
    const commentsAfter = await request.get(
      `${config.SUPABASE_URL}/rest/v1/comments?select=id&or=(topic_id.eq.${removedTopic},id.eq.${removedComment},id.eq.${retainedComment})`,
      { headers: adminHeaders },
    );
    expect(await commentsAfter.json()).toEqual([{ id: retainedComment }]);
    expect(
      (
        await request.get(
          `${config.SUPABASE_URL}/auth/v1/admin/users/${owner}`,
          { headers: adminHeaders },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post('/api/auth/login', {
          headers: origin,
          data: { email: ownerEmail, password },
        })
      ).status(),
    ).toBe(401);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const id of topics)
      await request.delete(
        `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${id}`,
        { headers: adminHeaders },
      );
    for (const id of accounts)
      await request.delete(`${config.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        headers: adminHeaders,
      });
  }
});
