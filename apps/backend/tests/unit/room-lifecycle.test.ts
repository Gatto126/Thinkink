import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopicRoom } from '../../src/discussion/room';
import { roomState } from '../../src/discussion/realtime';

vi.mock('../../src/discussion/realtime', () => ({
  roomState: vi.fn().mockResolvedValue({ exists: true, revision: '1' }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
function fixture(seen: number, expires: number) {
  let attachment = { id: 'reader', visible: true, seen, expires };
  const socket = {
    readyState: 1,
    deserializeAttachment: () => attachment,
    serializeAttachment: (value: typeof attachment) => {
      attachment = value;
    },
    send: vi.fn(),
    close: vi.fn(),
  };
  const storage = {
    get: vi.fn(async (key: string) => (key === 'topic' ? 'topic' : '1')),
    put: vi.fn(),
    getAlarm: vi.fn(async () => null),
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
  };
  const ctx = {
    storage,
    getWebSockets: () => [socket],
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => fn(),
  };
  const room = new TopicRoom(ctx as unknown as DurableObjectState, {});
  return { room, socket, storage };
}
describe('room reader leases', () => {
  it('expires a disconnected reader and stops recovery after the last lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const { room, socket, storage } = fixture(24999, 400000);
    await room.alarm();
    expect(socket.close).toHaveBeenCalledWith(4000, 'Reader expired');
    expect(roomState).not.toHaveBeenCalled();
    expect(storage.deleteAlarm).toHaveBeenCalled();
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });
  it('revalidates expired sessions even when heartbeat activity is recent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(400000);
    const { room, socket } = fixture(399999, 400000);
    await room.alarm();
    expect(socket.close).toHaveBeenCalledWith(4001, 'Refresh session');
    expect(roomState).not.toHaveBeenCalled();
  });
  it('rejects oversized messages and rapid visibility spam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const oversized = fixture(100000, 400000);
    await oversized.room.webSocketMessage(
      oversized.socket as unknown as WebSocket,
      'x'.repeat(257),
    );
    expect(oversized.socket.close).toHaveBeenCalledWith(
      1009,
      'Message too large',
    );
    const { room, socket } = fixture(100000, 400000);
    await room.webSocketMessage(
      socket as unknown as WebSocket,
      '{"type":"presence","visible":true}',
    );
    await room.webSocketMessage(
      socket as unknown as WebSocket,
      '{"type":"presence","visible":false}',
    );
    expect(socket.close).toHaveBeenCalledWith(1008, 'Too many messages');
  });
  it('does not count a socket that is closing with no status code', async () => {
    const { room, socket, storage } = fixture(Date.now(), Date.now() + 300000);
    await room.webSocketClose(socket as unknown as WebSocket, 1005, '');
    expect(socket.close).toHaveBeenCalledWith(1000, '');
    expect(storage.deleteAlarm).toHaveBeenCalled();
  });
});
