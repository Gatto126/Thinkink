import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as RuntimeResponse,
} from 'miniflare';
import type { WebSocket as RuntimeSocket } from 'miniflare';
import type { RoomMessage } from '@thinkink/shared/realtime';

const topic = 'f9000000-0000-4000-8000-000000000001';
const other = 'f9000000-0000-4000-8000-000000000002';
const user = 'f9000000-0000-4000-8000-000000000003';
const origin = 'https://thinkink.test';
let mf: Miniflare;
let revision: string;
let exists: boolean;
let unavailable: boolean;
let reads: number;
let sockets: RuntimeSocket[];

beforeEach(() => {
  revision = '0';
  exists = true;
  unavailable = false;
  reads = 0;
  sockets = [];
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'thinkink',
      modules: true,
      scriptPath: 'dist/index.js',
      compatibilityDate: '2026-09-20',
      durableObjects: {
        TOPIC_ROOMS: { className: 'TopicRoom', useSQLite: true },
      },
      bindings: {
        SUPABASE_URL: 'https://database.test',
        SUPABASE_PUBLISHABLE_KEY: 'fixture',
        AUTH_ALLOWED_ORIGINS: origin,
        AUTOMATED_TEST_MODE: 'true',
      },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname !== 'database.test')
          throw new Error('Unexpected outbound request');
        if (url.pathname === '/auth/v1/user')
          return RuntimeResponse.json({
            id: user,
            app_metadata: {},
            user_metadata: {},
          });
        if (url.pathname !== '/rest/v1/rpc/topic_room_state')
          throw new Error('Unexpected database call');
        reads++;
        const input = (await request.json()) as { topic_input: string };
        if (unavailable)
          return RuntimeResponse.json(
            { message: 'Unavailable' },
            { status: 503 },
          );
        return RuntimeResponse.json({
          exists,
          revision: input.topic_input === topic ? revision : '0',
        });
      },
    }),
  );
});
afterEach(async () => {
  for (const socket of sockets) if (socket.readyState < 2) socket.close();
  await mf.dispose();
});
async function connect(id = topic, signedIn = false) {
  const response = await mf.dispatchFetch(`${origin}/api/topics/${id}/live`, {
    headers: {
      Upgrade: 'websocket',
      Origin: origin,
      ...(signedIn ? { Cookie: '__Host-thinkink-access=fixture' } : {}),
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const messages: RoomMessage[] = [];
  socket.addEventListener('message', (event) =>
    messages.push(JSON.parse(String(event.data))),
  );
  socket.accept();
  sockets.push(socket);
  await expect.poll(() => messages.some((m) => m.type === 'sync')).toBe(true);
  return { socket, messages };
}
async function invalidate() {
  const rooms = (await mf.getDurableObjectNamespace(
    'TOPIC_ROOMS',
  )) as unknown as DurableObjectNamespace;
  return rooms.get(rooms.idFromName(topic)).fetch('https://room/invalidate', {
    method: 'POST',
    headers: { 'X-Topic-Id': topic },
  });
}
describe('TopicRoom in the Cloudflare runtime', () => {
  it('rejects foreign origins, non-upgrades, invalid and absent topics', async () => {
    for (const [id, headers, status] of [
      [topic, {}, 426],
      [topic, { Upgrade: 'websocket', Origin: 'https://foreign.test' }, 403],
      ['invalid', { Upgrade: 'websocket', Origin: origin }, 404],
    ] as const) {
      expect(
        (await mf.dispatchFetch(`${origin}/api/topics/${id}/live`, { headers }))
          .status,
      ).toBe(status);
    }
    exists = false;
    expect(
      (
        await mf.dispatchFetch(`${origin}/api/topics/${topic}/live`, {
          headers: { Upgrade: 'websocket', Origin: origin },
        })
      ).status,
    ).toBe(404);
  });
  it('broadcasts committed cursors only to that topic and deduplicates delivery', async () => {
    const a = await connect();
    const b = await connect();
    const c = await connect(other);
    revision = '1';
    await invalidate();
    await invalidate();
    for (const reader of [a, b]) {
      await expect
        .poll(
          () =>
            reader.messages.filter(
              (m) => m.type === 'sync' && m.revision === '1',
            ).length,
        )
        .toBe(1);
    }
    expect(
      c.messages.filter((m) => m.type === 'sync' && m.revision === '1'),
    ).toHaveLength(0);
    expect(JSON.stringify(a.messages)).not.toContain(user);
  });
  it('deduplicates signed-in presence and restores attachments after hibernation', async () => {
    const a = await connect(topic, true);
    const b = await connect(topic, true);
    const guest = await connect();
    for (const reader of [a, b, guest])
      reader.socket.send(JSON.stringify({ type: 'presence', visible: true }));
    await expect
      .poll(() => a.messages.filter((m) => m.type === 'presence').at(-1))
      .toEqual({ type: 'presence', readers: 1 });
    await mf.unsafeEvictDurableObject('thinkink', 'TopicRoom', {
      name: topic,
      webSockets: 'hibernate',
    });
    revision = '2';
    await invalidate();
    await expect
      .poll(() =>
        b.messages.some((m) => m.type === 'sync' && m.revision === '2'),
      )
      .toBe(true);
    a.socket.close();
    await expect
      .poll(() => b.messages.filter((m) => m.type === 'presence').at(-1))
      .toEqual({ type: 'presence', readers: 1 });
    b.socket.close();
    await expect
      .poll(() => guest.messages.filter((m) => m.type === 'presence').at(-1))
      .toEqual({ type: 'presence', readers: 0 });
  });
  it('recovers a missed notification through the real alarm and reconnect snapshot', async () => {
    const a = await connect();
    revision = '3'; // Simulate a DB commit followed by Worker failure before notification.
    await expect
      .poll(
        () => a.messages.some((m) => m.type === 'sync' && m.revision === '3'),
        { timeout: 15000 },
      )
      .toBe(true);
    a.socket.close();
    revision = '4';
    const b = await connect();
    expect(b.messages).toContainEqual({ type: 'sync', revision: '4' });
  });
  it('closes deleted topics and rejects client writes instead of broadcasting them', async () => {
    const a = await connect();
    const closed = new Promise<number>((resolve) =>
      a.socket.addEventListener('close', (event) => resolve(event.code)),
    );
    a.socket.send(JSON.stringify({ type: 'comment', body: 'Injected' }));
    expect(await closed).toBe(1008);
    const b = await connect();
    exists = false;
    await invalidate();
    await expect
      .poll(() => b.messages.some((m) => m.type === 'deleted'))
      .toBe(true);
  });
  it('does not advance the cursor on database failure', async () => {
    const a = await connect();
    unavailable = true;
    revision = '5';
    await invalidate().catch(() => {});
    expect(
      a.messages.some((m) => m.type === 'sync' && m.revision === '5'),
    ).toBe(false);
    unavailable = false;
    const b = await connect();
    expect(b.messages).toContainEqual({ type: 'sync', revision: '5' });
    expect(reads).toBeGreaterThan(1);
  });
});
