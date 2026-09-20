import { roomClientMessageSchema } from '@thinkink/shared/realtime';
import type { RoomMessage } from '@thinkink/shared/realtime';
import type { AuthEnv } from '../auth/config';
import { roomState } from './realtime';

const RECOVERY_MS = 10000;
const LEASE_MS = 75000;
const SESSION_MS = 5 * 60 * 1000;
type Reader = {
  id: string;
  visible: boolean;
  seen: number;
  expires: number;
  messageAt?: number;
  closed?: boolean;
};

// SQLite stores operational identity/cursor only; Postgres owns all content.
// Hibernating sockets retain their attachments across object eviction.
export class TopicRoom implements DurableObject {
  constructor(
    private ctx: DurableObjectState,
    private env: AuthEnv,
  ) {}

  private sockets() {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws.readyState === 1 && !(ws.deserializeAttachment() as Reader).closed,
      );
  }
  private close(ws: WebSocket, code: number, reason: string) {
    ws.serializeAttachment({
      ...(ws.deserializeAttachment() as Reader),
      closed: true,
    });
    // Received close codes may include reserved, non-sendable values (1005/1006).
    if (ws.readyState < 2)
      ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
  }
  private send(ws: WebSocket, message: RoomMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.close(ws, 1011, 'Reconnect');
    }
  }
  private broadcast(message: RoomMessage) {
    for (const ws of this.sockets()) this.send(ws, message);
  }
  private presence() {
    const now = Date.now();
    const readers = new Set<string>();
    for (const ws of this.sockets()) {
      const reader = ws.deserializeAttachment() as Reader;
      if (
        reader.id &&
        reader.visible &&
        reader.seen + LEASE_MS > now &&
        reader.expires > now
      )
        readers.add(reader.id);
    }
    this.broadcast({ type: 'presence', readers: readers.size });
  }
  private async schedule() {
    if (this.sockets().length) {
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + RECOVERY_MS);
    } else await this.ctx.storage.deleteAlarm();
  }
  private async sync(topicId: string) {
    // Serialize reads/broadcasts: an older query may never publish after a newer one.
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await roomState(this.env, topicId);
      if (!state.exists) {
        this.broadcast({ type: 'deleted' });
        for (const ws of this.sockets()) this.close(ws, 4004, 'Topic deleted');
        await this.ctx.storage.deleteAlarm();
        return state;
      }
      const revision = await this.ctx.storage.get<string>('revision');
      if (state.revision !== revision) {
        this.broadcast({ type: 'sync', revision: state.revision });
        await this.ctx.storage.put('revision', state.revision);
      }
      return state;
    });
  }
  async fetch(request: Request): Promise<Response> {
    const topicId = request.headers.get('X-Topic-Id');
    if (!topicId) return new Response(null, { status: 400 });
    const saved = await this.ctx.storage.get<string>('topic');
    if (saved && saved !== topicId) return new Response(null, { status: 403 });
    if (!saved) await this.ctx.storage.put('topic', topicId);
    const url = new URL(request.url);
    if (url.pathname === '/invalidate' && request.method === 'POST') {
      if (this.sockets().length) await this.sync(topicId);
      return new Response(null, { status: 204 });
    }
    if (
      url.pathname !== '/connect' ||
      request.headers.get('Upgrade') !== 'websocket'
    )
      return new Response(null, { status: 404 });
    if (this.sockets().length >= 200)
      return new Response(null, { status: 503 });
    const state = await this.sync(topicId);
    if (!state.exists) return new Response(null, { status: 404 });
    if (this.sockets().length >= 200)
      return new Response(null, { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.serializeAttachment({
      id: request.headers.get('X-Reader-Id') ?? '',
      visible: false,
      seen: Date.now(),
      expires: Date.now() + SESSION_MS,
    } satisfies Reader);
    this.ctx.acceptWebSocket(server);
    this.send(server, { type: 'sync', revision: state.revision });
    this.presence();
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 256) {
      this.close(ws, 1009, 'Message too large');
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(message);
    } catch {
      this.close(ws, 1008, 'Invalid message');
      return;
    }
    const input = roomClientMessageSchema.safeParse(value);
    if (!input.success) {
      this.close(ws, 1008, 'Invalid message');
      return;
    }
    const reader = ws.deserializeAttachment() as Reader;
    const now = Date.now();
    if (reader.expires <= now) {
      this.close(ws, 4001, 'Refresh session');
      return;
    }
    if (now - (reader.messageAt ?? 0) < 500) {
      this.close(ws, 1008, 'Too many messages');
      return;
    }
    ws.serializeAttachment({
      ...reader,
      visible: input.data.visible,
      seen: now,
      messageAt: now,
    });
    this.send(ws, { type: 'pong' });
    this.presence();
  }
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.close(ws, code, reason);
    this.presence();
    await this.schedule();
  }
  async webSocketError(ws: WebSocket) {
    this.close(ws, 1011, 'Reconnect');
    this.presence();
    await this.schedule();
  }
  async alarm() {
    try {
      for (const ws of this.sockets()) {
        const reader = ws.deserializeAttachment() as Reader;
        if (reader.expires <= Date.now())
          this.close(ws, 4001, 'Refresh session');
        else if (reader.seen + LEASE_MS <= Date.now())
          this.close(ws, 4000, 'Reader expired');
      }
      if (this.sockets().length) {
        const topicId = await this.ctx.storage.get<string>('topic');
        if (topicId) await this.sync(topicId);
        this.presence();
      }
    } finally {
      // A failed DB read must not stop recovery; no news/AI work runs here.
      if (this.sockets().length)
        await this.ctx.storage.setAlarm(Date.now() + RECOVERY_MS);
      else await this.ctx.storage.deleteAlarm();
    }
  }
}
