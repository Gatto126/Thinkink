import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { roomMessageSchema } from '@thinkink/shared/realtime';
import { useSession } from '../auth/session';

const initial = { connected: false, revision: 0, readers: 0, deleted: false };
const RoomContext = createContext(initial);
export const useTopicRoom = () => useContext(RoomContext);

export function TopicRoom({
  topicId,
  children,
}: {
  topicId: string;
  children: ReactNode;
}) {
  const session = useSession();
  const [state, setState] = useState(initial);
  useEffect(() => {
    setState(initial);
    if (session.loading) return;
    let disposed = false;
    let deleted = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let backoff = 500;
    let lastMessage = Date.now();
    let cursor: string | undefined;
    const presence = () => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({ type: 'presence', visible: !document.hidden }),
        );
    };
    const connect = () => {
      if (disposed || deleted || document.hidden || !navigator.onLine) return;
      if (socket && socket.readyState < WebSocket.CLOSING) return;
      const url = new URL(`/api/topics/${topicId}/live`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const current = new WebSocket(url);
      socket = current;
      deadline = setTimeout(() => current.close(), 10000);
      let first = true;
      current.onopen = () => {
        clearTimeout(deadline);
        lastMessage = Date.now();
        presence();
      };
      current.onmessage = (event) => {
        if (disposed || socket !== current || typeof event.data !== 'string')
          return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const message = roomMessageSchema.safeParse(parsed);
        if (!message.success) return;
        lastMessage = Date.now();
        const value = message.data;
        if (value.type === 'sync') {
          // Every new connection reloads a snapshot, including when the cursor
          // did not change. This recovers failed reads and changed permissions.
          if (
            first ||
            cursor === undefined ||
            BigInt(value.revision) > BigInt(cursor)
          ) {
            cursor = value.revision;
            setState((old) => ({
              ...old,
              connected: true,
              revision: old.revision + 1,
            }));
          }
          first = false;
          backoff = 500;
        } else if (value.type === 'presence') {
          setState((old) => ({ ...old, readers: value.readers }));
        } else if (value.type === 'deleted') {
          deleted = true;
          setState((old) => ({ ...old, connected: false, deleted: true }));
          current.close();
        }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        clearTimeout(deadline);
        if (disposed || socket !== current) return;
        setState((old) => ({ ...old, connected: false, readers: 0 }));
        if (!deleted) {
          retry = setTimeout(connect, backoff + Math.random() * 250);
          backoff = Math.min(backoff * 2, 30000);
        }
      };
    };
    const resume = () => {
      if (document.hidden) {
        socket?.close(1000, 'Reader hidden');
      } else {
        clearTimeout(retry);
        if (
          socket?.readyState === WebSocket.OPEN &&
          Date.now() - lastMessage > 60000
        )
          socket.close();
        else connect();
      }
    };
    const heartbeat = setInterval(() => {
      if (document.hidden) return;
      if (
        socket?.readyState === WebSocket.OPEN &&
        Date.now() - lastMessage > 60000
      )
        socket.close();
      else presence();
    }, 25000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(deadline);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      socket?.close(1000, 'Reader left');
    };
  }, [topicId, session.user?.id, session.loading]);
  return <RoomContext.Provider value={state}>{children}</RoomContext.Provider>;
}
