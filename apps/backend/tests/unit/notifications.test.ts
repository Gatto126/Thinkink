import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/index';
import { topicTitleSchema } from '@thinkink/shared/contracts';
const origin = 'http://127.0.0.1:4173';
const id = 'fa000000-0000-4000-8000-000000000001';
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
describe('notification boundaries', () => {
  it('requires verified authentication and rejects foreign mutations', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(
      (await handleRequest(new Request(`${origin}/api/notifications`), env))
        .status,
    ).toBe(401);
    expect(
      (
        await handleRequest(
          new Request(`${origin}/api/notifications/read`, {
            method: 'POST',
            headers: { ...headers, Origin: 'https://foreign.test' },
            body: JSON.stringify({ id }),
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses only the caller JWT and never accepts a recipient override', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('/auth/v1/user')
          ? Response.json({ id, app_metadata: {} })
          : Response.json({ items: [], unreadCount: 0, hasMore: false }),
      );
    const response = await handleRequest(
      new Request(
        `${origin}/api/notifications?offset=20&recipient=someone-else`,
        { headers },
      ),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    const call = fetch.mock.calls.find(([url]) =>
      String(url).includes('/rpc/my_notifications'),
    )!;
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe(
      'Bearer token',
    );
    expect(JSON.parse(String(call[1]?.body))).toEqual({ offset_input: 20 });
    const denied = await handleRequest(
      new Request(`${origin}/api/notifications/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, recipient: id }),
      }),
      env,
    );
    expect(denied.status).toBe(400);
  });
  it('keeps source errors private and rejects invalid pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/auth/v1/user')
        ? Response.json({ id, app_metadata: {} })
        : Response.json({ message: 'internal detail' }, { status: 500 }),
    );
    expect(
      (
        await handleRequest(
          new Request(`${origin}/api/notifications?offset=-1`, { headers }),
          env,
        )
      ).status,
    ).toBe(400);
    const response = await handleRequest(
      new Request(`${origin}/api/notifications`, { headers }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('internal detail');
  });
  it('capitalizes normalized titles consistently without lowercasing acronyms', () => {
    expect(topicTitleSchema.parse('  bitcoin  and AI ')).toBe('Bitcoin and AI');
    expect(topicTitleSchema.parse('énergie')).toBe('Énergie');
    expect(topicTitleSchema.parse('NASA')).toBe('NASA');
  });
});
