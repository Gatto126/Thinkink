import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { handleModeration } from '../../src/moderation/routes';
import { assertAccountEnvironment } from '../../src/auth/request';
const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test',
  SUPABASE_SECRET_KEY: 'test',
  AUTH_LOCAL_SIGNUP: 'true',
  SIGNUP_INVITE_CODE: 'test',
};
const id = 'f6100000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:4173';
const user = { id, app_metadata: {}, email: 'owner@example.test' };
const mutation = (
  headers: Record<string, string> = {},
  confirmation: unknown = true,
) =>
  new Request(`${origin}/api/topics/${id}`, {
    method: 'DELETE',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ confirmation }),
  });
describe('content management boundaries', () => {
  it('denies anonymous deletion and foreign origins before database changes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await handleModeration(mutation(), env)).status).toBe(401);
    expect(
      (
        await handleModeration(
          mutation({ Origin: 'https://foreign.test' }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleModeration(
          new Request(`${origin}/api/moderation/topics`),
          env,
        )
      ).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation even for an authenticated user', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(user));
    expect(
      (
        await handleModeration(
          mutation({ Cookie: 'thinkink-access=token' }, false),
          env,
        )
      ).status,
    ).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain('/auth/v1/user');
  });
  it('uses the caller JWT and honors database permission rejection', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('/auth/v1/user')
          ? Response.json(user)
          : Response.json(
              { code: '42501', message: 'Denied' },
              { status: 403 },
            ),
      );
    expect(
      (
        await handleModeration(
          mutation({ Cookie: 'thinkink-access=token' }),
          env,
        )
      ).status,
    ).toBe(403);
    const call = fetch.mock.calls.find(([url]) =>
      String(url).includes('/rpc/delete_topic'),
    );
    expect(call).toBeDefined();
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
  });
  it('confines development accounts to local app and database URLs', () => {
    const fixture: User = {
      id,
      aud: 'authenticated',
      created_at: '2026-09-20T12:00:00Z',
      user_metadata: {},
      app_metadata: { localDevelopmentOnly: true },
    };
    expect(() =>
      assertAccountEnvironment(fixture, new Request(origin), env),
    ).not.toThrow();
    expect(() =>
      assertAccountEnvironment(
        fixture,
        new Request('https://thinkink.example'),
        env,
      ),
    ).toThrow('only locally');
    expect(() =>
      assertAccountEnvironment(fixture, new Request(origin), {
        ...env,
        SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toThrow('only locally');
    expect(() =>
      assertAccountEnvironment(fixture, new Request(origin), {
        ...env,
        AUTH_LOCAL_SIGNUP: 'false',
      }),
    ).toThrow('only locally');
  });
});

describe('overview editing endpoint', () => {
  const edit = (value: unknown, headers: Record<string, string> = {}) =>
    new Request(`${origin}/api/topics/${id}/overview`, {
      method: 'PATCH',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(value),
    });
  const draft = {
    headline: 'Edited headline',
    paragraphs: [{ text: 'Edited text', sourceIds: [] }],
    revision: 0,
  };
  it('rejects unauthenticated and foreign-origin writes without contacting a provider', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    expect((await handleModeration(edit(draft), env)).status).toBe(401);
    expect(
      (
        await handleModeration(
          edit(draft, { Origin: 'https://foreign.test' }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects attribution forgery before database mutation', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(user));
    expect(
      (
        await handleModeration(
          edit(
            { ...draft, model: 'fake' },
            { Cookie: 'thinkink-access=token' },
          ),
          env,
        )
      ).status,
    ).toBe(400);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('passes the authenticated JWT and reports edit conflicts', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('/auth/v1/user')
          ? Response.json(user)
          : Response.json(
              { code: '40001', message: 'Overview changed' },
              { status: 409 },
            ),
      );
    expect(
      (
        await handleModeration(
          edit(draft, { Cookie: 'thinkink-access=token' }),
          env,
        )
      ).status,
    ).toBe(409);
    const call = request.mock.calls.find(([url]) =>
      String(url).includes('/rpc/edit_topic_overview'),
    );
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('registered user management', () => {
  const removeUser = (
    confirmation: unknown = true,
    cookie = 'thinkink-access=token',
    requestOrigin = origin,
    target = id,
  ) =>
    new Request(`${origin}/api/moderation/users/${target}`, {
      method: 'DELETE',
      headers: {
        Origin: requestOrigin,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmation }),
    });
  it('rejects anonymous reads, anonymous deletes and foreign-origin deletes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(
      (
        await handleModeration(
          new Request(`${origin}/api/moderation/users`),
          env,
        )
      ).status,
    ).toBe(401);
    expect((await handleModeration(removeUser(true, ''), env)).status).toBe(
      401,
    );
    expect(
      (
        await handleModeration(
          removeUser(true, '', 'https://foreign.test'),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires confirmation and a valid user ID before a mutation', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(user));
    expect((await handleModeration(removeUser(false), env)).status).toBe(400);
    expect(
      (
        await handleModeration(
          removeUser(true, 'thinkink-access=token', origin, 'invalid'),
          env,
        )
      ).status,
    ).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.every(([url]) => String(url).includes('/auth/v1/user')),
    ).toBe(true);
  });
  it('lists users with bounded search filters and the caller JWT', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        Response.json(
          String(url).includes('/auth/v1/user')
            ? user
            : { items: [], hasMore: false },
        ),
      );
    const response = await handleModeration(
      new Request(`${origin}/api/moderation/users?q=alice&offset=50`, {
        headers: { Cookie: 'thinkink-access=token' },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const call = fetch.mock.calls.find(([url]) =>
      String(url).includes('/rpc/moderation_users'),
    );
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      query_input: 'alice',
      offset_input: 50,
    });
    expect(
      (
        await handleModeration(
          new Request(`${origin}/api/moderation/users?offset=-1`, {
            headers: { Cookie: 'thinkink-access=token' },
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
  it.each([
    ['42501', 403],
    ['22023', 400],
    ['P0002', 404],
    ['XX000', 503],
  ])(
    'reports database rejection %s without claiming successful deletion',
    async (code, status) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
        String(url).includes('/auth/v1/user')
          ? Response.json(user)
          : Response.json({ code, message: 'Rejected' }, { status: 400 }),
      );
      const response = await handleModeration(removeUser(), env);
      expect(response.status).toBe(status);
      expect(await response.json()).not.toHaveProperty('deleted');
    },
  );
  it('uses one atomic user deletion RPC authenticated as the moderator', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) =>
        Response.json(String(url).includes('/auth/v1/user') ? user : true),
      );
    const response = await handleModeration(removeUser(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    const call = fetch.mock.calls.find(([url]) =>
      String(url).includes('/rpc/moderate_user'),
    );
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ user_input: id });
  });
});
