import { useEffect, useState } from 'react';
import { z } from 'zod';
import { notificationsSchema } from '@thinkink/shared/contracts';
import type { Notifications } from '@thinkink/shared/contracts';
import { readApi } from '../api';

const empty: Notifications = { items: [], unreadCount: 0, hasMore: false };
export function useNotifications(userId: string | undefined, open: boolean) {
  const [inbox, setInbox] = useState({ userId, data: empty });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    setOffset(0);
    setInbox({ userId, data: empty });
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let running = false;
    setLoading(true);
    async function load() {
      if (document.hidden || running) return;
      running = true;
      try {
        const data = await readApi(
          `/api/notifications?offset=${offset}`,
          notificationsSchema,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setInbox({ userId, data });
          setError('');
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Notifications could not be loaded.',
          );
      } finally {
        running = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const refresh = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [userId, open, offset, revision]);
  const data = inbox.userId === userId && userId ? inbox.data : empty;
  async function markRead(id: string | null) {
    if (reading || !userId) return false;
    setReading(true);
    setReadError('');
    try {
      await readApi(
        '/api/notifications/read',
        z.object({ read: z.literal(true) }),
        new AbortController().signal,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        },
      );
      setInbox((value) => ({
        ...value,
        data: {
          ...value.data,
          items: value.data.items.map((item) =>
            !id || item.id === id ? { ...item, read: true } : item,
          ),
          unreadCount: id
            ? Math.max(
                0,
                value.data.unreadCount -
                  Number(
                    value.data.items.some(
                      (item) => item.id === id && !item.read,
                    ),
                  ),
              )
            : 0,
        },
      }));
      setRevision((value) => value + 1);
      return true;
    } catch (error) {
      setReadError(
        error instanceof Error ? error.message : 'Please try again.',
      );
      return false;
    } finally {
      setReading(false);
    }
  }
  return {
    data,
    error: readError || error,
    loading,
    offset,
    setOffset,
    markRead,
    reading,
    reload: () => {
      setReadError('');
      setRevision((value) => value + 1);
    },
  };
}

export function notificationTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return 'Just now';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour');
  return format.format(-Math.floor(minutes / 1440), 'day');
}
