import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('real local Supabase accounts', () => {
  test.skip(
    process.env.THINKINK_LOCAL_AUTH_TESTS !== '1',
    'Run npm run test:e2e:local with local Supabase.',
  );
  test('curated avatars, immutable identity, sessions and password-confirmed account deletion', async ({
    page,
    request,
    baseURL,
  }) => {
    const config = parseEnv(readFileSync('apps/backend/.dev.vars', 'utf8'));
    expect(new URL(config.SUPABASE_URL!).hostname).toBe('127.0.0.1');
    expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 14);
    const email = `e2e-${suffix}@example.test`,
      username = `reader_${suffix}`,
      password = `Local-only-${randomUUID()}`;
    let id: string | undefined,
      otherId: string | undefined,
      topicId: string | undefined;
    const adminHeaders = {
      apikey: config.SUPABASE_SECRET_KEY!,
      Authorization: `Bearer ${config.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    };
    const origin = { Origin: baseURL! };
    try {
      const directSignup = await request.post(
        `${config.SUPABASE_URL}/auth/v1/signup`,
        {
          headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY! },
          data: { email, password },
        },
      );
      expect((await directSignup.json()).error_code).toBe('signup_disabled');
      await page.goto('/signup');
      await page.getByLabel('Username', { exact: true }).fill(username);
      await page.getByLabel('Email address').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Invitation code').fill('invalid-invitation');
      await page
        .getByRole('button', { name: 'Create account', exact: true })
        .click();
      await expect(page.getByRole('alert')).toHaveText(
        'This invitation code is not valid.',
      );
      await page.getByLabel('Invitation code').fill(config.SIGNUP_INVITE_CODE!);
      await page
        .getByRole('button', { name: 'Create account', exact: true })
        .click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      await expect(
        page.getByRole('textbox', { name: 'Username', exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      const state = await (await page.request.get('/api/auth/session')).json();
      id = state.user.id;
      expect(state).not.toHaveProperty('access_token');
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        'thinkink-access',
      );
      expect(
        (await page.context().cookies())
          .filter((c) => c.name.startsWith('thinkink-'))
          .every((c) => c.httpOnly && c.sameSite === 'Lax'),
      ).toBe(true);
      const catalog = await (await request.get('/api/avatars')).json();
      expect(catalog.avatars.length).toBeGreaterThan(0);
      for (const avatar of catalog.avatars)
        expect((await request.get(avatar.src)).ok()).toBe(true);
      await page.getByRole('radio', { name: 'Iris', exact: true }).check();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(
        page.getByRole('button', { name: 'Account menu' }).locator('img'),
      ).toHaveAttribute('src', '/avatars/iris.svg');
      // The compact shared header hides navigation until the page returns to the top.
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.getByRole('link', { name: 'Mission' }).click();
      await expect(
        page.getByRole('button', { name: 'Account menu' }).locator('img'),
      ).toHaveAttribute('src', '/avatars/iris.svg');
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await expect(
        page.getByRole('radio', { name: 'Iris', exact: true }),
      ).toBeChecked();
      await page.getByRole('radio', { name: 'Orbit', exact: true }).check();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Account menu' }).locator('img'),
      ).toHaveAttribute('src', '/avatars/orbit.svg');
      // Force token renewal without waiting for expiry.
      await page.context().clearCookies({ name: 'thinkink-access' });
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Account menu' }),
      ).toBeVisible();
      await expect(page.locator('.header-account')).toHaveAttribute(
        'aria-busy',
        'false',
      );
      const access = (await page.context().cookies()).find(
        (c) => c.name === 'thinkink-access',
      )!.value;
      const userHeaders = {
        apikey: config.SUPABASE_PUBLISHABLE_KEY!,
        Authorization: `Bearer ${access}`,
      };
      for (const input of [
        { username: 'changed', avatarId: 'iris' },
        { email: 'changed@example.test', avatarId: 'iris' },
        { avatarId: 'unlisted-avatar' },
        { avatarId: 'https://example.com/upload.png' },
      ]) {
        const invalid = await page.request.patch('/api/auth/profile', {
          headers: origin,
          data: input,
        });
        expect(invalid.status()).toBe(400);
      }
      expect(
        (
          await page.request.patch('/api/auth/profile', {
            headers: { Origin: 'https://foreign.example' },
            data: { avatarId: 'iris' },
          })
        ).status(),
      ).toBe(403);
      const identityChange = await request.patch(
        `${config.SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`,
        { headers: userHeaders, data: { username: 'changed' } },
      );
      expect(identityChange.status()).toBe(403);
      const other = await request.post(
        `${config.SUPABASE_URL}/auth/v1/admin/users`,
        {
          headers: adminHeaders,
          data: {
            email: `other-${suffix}@example.test`,
            password,
            email_confirm: true,
            user_metadata: { username: `other_${suffix}` },
          },
        },
      );
      expect(other.ok()).toBe(true);
      otherId = (await other.json()).id;
      const rows = await request.get(
        `${config.SUPABASE_URL}/rest/v1/profiles?select=id,avatar_id`,
        { headers: userHeaders },
      );
      expect(await rows.json()).toEqual([{ id, avatar_id: 'orbit' }]);
      const denied = await request.patch(
        `${config.SUPABASE_URL}/rest/v1/profiles?id=eq.${otherId}`,
        {
          headers: { ...userHeaders, Prefer: 'return=representation' },
          data: { avatar_id: 'iris' },
        },
      );
      expect(await denied.json()).toEqual([]);
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      const beforeLogout = (await page.context().cookies()).find(
        (c) => c.name === 'thinkink-refresh',
      )!.value;
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
      expect(
        (await page.context().cookies()).filter((c) =>
          ['thinkink-access', 'thinkink-refresh'].includes(c.name),
        ),
      ).toEqual([]);
      const revoked = await request.get('/api/auth/session', {
        headers: { Cookie: `thinkink-refresh=${beforeLogout}` },
      });
      expect((await revoked.json()).user).toBeNull();
      await page.getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.getByLabel('Email address').fill(email);
      await page
        .getByLabel('Password', { exact: true })
        .fill('incorrect-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText(
        'Email or password is incorrect.',
      );
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
      // Synthetic shared content checks the actual Auth deletion transaction.
      topicId = randomUUID();
      const commentId = randomUUID();
      expect(
        (
          await request.post(`${config.SUPABASE_URL}/rest/v1/topics`, {
            headers: adminHeaders,
            data: {
              id: topicId,
              title: `A retained test topic ${suffix}`,
              created_by: id,
            },
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await request.post(`${config.SUPABASE_URL}/rest/v1/comments`, {
            headers: adminHeaders,
            data: {
              id: commentId,
              topic_id: topicId,
              body: 'A retained test comment',
              author_id: id,
            },
          })
        ).ok(),
      ).toBe(true);
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByText('Delete account', { exact: true }).click();
      await page
        .getByLabel('Re-enter your password')
        .fill('incorrect-password');
      await page.getByLabel('I understand that this cannot be undone.').check();
      await page
        .getByRole('button', { name: 'Permanently delete account' })
        .click();
      await expect(page.getByRole('alert')).toHaveText(
        'Your password is incorrect. Your account has not been deleted.',
      );
      expect(
        (
          await request.get(
            `${config.SUPABASE_URL}/auth/v1/admin/users/${id}`,
            { headers: adminHeaders },
          )
        ).ok(),
      ).toBe(true);
      const unsafe = await page.request.delete('/api/auth/account', {
        headers: origin,
        data: { password, confirmation: true, id: otherId },
      });
      expect(unsafe.status()).toBe(400);
      const oldCookies = (await page.context().cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      await page.getByLabel('Re-enter your password').fill(password);
      await page.getByLabel('I understand that this cannot be undone.').check();
      await page
        .getByRole('button', { name: 'Permanently delete account' })
        .click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(
        page.getByRole('link', { name: 'Sign in', exact: true }),
      ).toBeVisible();
      expect(
        (await page.context().cookies()).filter((c) =>
          ['thinkink-access', 'thinkink-refresh'].includes(c.name),
        ),
      ).toEqual([]);
      expect(
        (
          await request.get(
            `${config.SUPABASE_URL}/auth/v1/admin/users/${id}`,
            { headers: adminHeaders },
          )
        ).status(),
      ).toBe(404);
      expect(
        await (
          await request.get(
            `${config.SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`,
            { headers: adminHeaders },
          )
        ).json(),
      ).toEqual([]);
      expect(
        (
          await (
            await request.get('/api/auth/session', {
              headers: { Cookie: oldCookies },
            })
          ).json()
        ).user,
      ).toBeNull();
      expect(
        (
          await request.get(
            `${config.SUPABASE_URL}/auth/v1/admin/users/${otherId}`,
            { headers: adminHeaders },
          )
        ).ok(),
      ).toBe(true);
      const retained = await (
        await request.get(
          `${config.SUPABASE_URL}/rest/v1/comments?id=eq.${commentId}&select=body,author_id`,
          { headers: adminHeaders },
        )
      ).json();
      expect(retained).toEqual([
        { body: 'A retained test comment', author_id: null },
      ]);
      const anonymous = { apikey: config.SUPABASE_PUBLISHABLE_KEY! };
      expect(
        await (
          await request.get(
            `${config.SUPABASE_URL}/rest/v1/comments?id=eq.${commentId}&select=body`,
            { headers: anonymous },
          )
        ).json(),
      ).toEqual([{ body: 'A retained test comment' }]);
      expect(
        await (
          await request.get(
            `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${topicId}&select=title`,
            { headers: anonymous },
          )
        ).json(),
      ).toEqual([{ title: `A retained test topic ${suffix}` }]);
    } finally {
      const listed = await request.get(
        `${config.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
        { headers: adminHeaders },
      );
      if (listed.ok()) {
        const users = (await listed.json()).users as {
          id: string;
          email: string;
        }[];
        for (const user of users.filter((user) =>
          [email, `other-${suffix}@example.test`].includes(user.email),
        ))
          expect(
            (
              await request.delete(
                `${config.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
                { headers: adminHeaders },
              )
            ).ok(),
          ).toBe(true);
      }
      if (topicId)
        expect(
          (
            await request.delete(
              `${config.SUPABASE_URL}/rest/v1/topics?id=eq.${topicId}`,
              { headers: adminHeaders },
            )
          ).ok(),
        ).toBe(true);
    }
  });
});
