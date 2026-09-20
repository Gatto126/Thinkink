import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../../src/index';
import { ensureReaderCookie, handleVisit } from '../../src/discussion/visits';
const id = 'df000000-0000-4000-8000-000000000001';
const origin = 'http://127.0.0.1:4173';
const env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test',
  SUPABASE_SECRET_KEY: 'test',
};
const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ id, body: 'A comment' }),
  });
describe('beta participation API boundaries', () => {
  it('requires authentication to comment and same origin for mutations', async () => {
    const request = vi.spyOn(globalThis, 'fetch');
    expect(
      (await handleRequest(post(`/api/topics/${id}/comments`), env)).status,
    ).toBe(401);
    expect(
      (
        await handleRequest(
          post(`/api/topics/${id}/comments`, {
            Origin: 'https://foreign.test',
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleVisit(
          post(`/api/topics/${id}/views`, { Origin: 'https://foreign.test' }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
  it('only submits visits with a valid signed first-party reader cookie and stores no raw identity', async () => {
    const headers = new Headers();
    await ensureReaderCookie(new Request(origin), env, headers);
    const cookie = headers.getSetCookie()[0]!.split(';')[0]!;
    expect(cookie).toMatch(/^thinkink-reader=[a-f0-9-]+\.[a-f0-9]{64}$/);
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(true));
    expect(
      (
        await handleVisit(
          post(`/api/topics/${id}/views`, {
            Cookie: cookie.slice(0, -1) + 'x',
          }),
          env,
        )
      ).status,
    ).toBe(202);
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await handleVisit(
          post(`/api/topics/${id}/views`, { Cookie: cookie }),
          env,
        )
      ).status,
    ).toBe(204);
    expect(request).toHaveBeenCalledTimes(1);
    const data = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(data.topic_input).toBe(id);
    expect(data.visitor_input).toMatch(/^[a-f0-9]{64}$/);
    expect(data.visitor_input).not.toContain(
      cookie.split('=')[1]!.split('.')[0],
    );
  });
  it('does not enter a cookie retry loop when visit configuration is unavailable', async () => {
    expect(
      (await handleVisit(post(`/api/topics/${id}/views`), {})).status,
    ).toBe(503);
  });
});

describe('threaded comment reads', () => {
  it.each([
    ['threaded=true', null],
    [`thread=${id}`, id],
  ])('loads a bounded thread page for %s', async (query, threadId) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        Response.json({ items: [], total: 0, hasMore: false }),
      );
    const response = await handleRequest(
      new Request(`${origin}/api/topics/${id}/comments?${query}&offset=50`),
      env,
    );
    expect(response.status).toBe(200);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      '/rpc/topic_comment_threads',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      topic_input: id,
      offset_input: 50,
      thread_input: threadId,
    });
  });
  it('rejects invalid thread IDs before database access', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(
      (
        await handleRequest(
          new Request(`${origin}/api/topics/${id}/comments?thread=invalid`),
          env,
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
