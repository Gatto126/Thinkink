import { describe, it, expect, vi } from 'vitest';
import { handleRequest } from '../../src/index';
const id = 'fd000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:4173';
const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'public',
  SUPABASE_SECRET_KEY: 'secret',
};
const headers = {
  Cookie: 'thinkink-access=token',
  Origin: origin,
  'Content-Type': 'application/json',
};
describe('social API', () => {
  it('requires a verified user and same-origin writes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const path of [
      `/api/comments/${id}/like`,
      `/api/topics/${id}/social`,
    ]) {
      expect(
        (
          await handleRequest(
            new Request(origin + path, {
              method: 'PUT',
              headers: { Origin: origin, 'Content-Type': 'application/json' },
              body: '{"selected":true}',
            }),
            env,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await handleRequest(
            new Request(origin + path, {
              method: 'PUT',
              headers: { ...headers, Origin: 'https://foreign.test' },
              body: '{"selected":true}',
            }),
            env,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (await handleRequest(new Request(origin + '/api/favorites'), env)).status,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses only the caller identity and rejects account overrides', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('/auth/v1/user')
          ? Response.json({ id, app_metadata: {} })
          : Response.json({ id, liked: true, likeCount: 2 }),
      );
    const response = await handleRequest(
      new Request(`${origin}/api/comments/${id}/like`, {
        method: 'PUT',
        headers,
        body: '{"selected":true}',
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const call = fetch.mock.calls.find(([url]) =>
      String(url).includes('/rpc/set_comment_like'),
    )!;
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      comment_input: id,
      liked_input: true,
    });
    expect(
      (
        await handleRequest(
          new Request(`${origin}/api/comments/${id}/like`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ selected: true, userId: id }),
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
  it('normalizes favorite dates and bounds pagination', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/auth/v1/user')
        ? Response.json({ id, app_metadata: {} })
        : Response.json({
            items: [
              {
                id,
                title: 'Saved topic',
                createdAt: '2026-09-20T12:00:00+00:00',
                updatedAt: '2026-09-20T12:00:00+00:00',
              },
            ],
            hasMore: false,
          }),
    );
    const response = await handleRequest(
      new Request(origin + '/api/favorites', { headers }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty(
      'items.0.createdAt',
      '2026-09-20T12:00:00.000Z',
    );
    expect(
      (
        await handleRequest(
          new Request(origin + '/api/favorites?offset=-1', { headers }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});
