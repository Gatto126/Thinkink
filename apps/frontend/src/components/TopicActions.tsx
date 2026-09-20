import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, MessageCircle, Star } from 'lucide-react';
import { topicSocialSchema } from '@thinkink/shared/contracts';
import type { TopicData } from '@thinkink/shared/contracts';
import { useSession } from '../auth/session';
import { readApi } from '../api';
import type { z } from 'zod';

export function TopicActions({
  data,
  commentCount = null,
  favoriteOnly = false,
}: {
  data: Pick<TopicData, 'id' | 'visits' | 'commentCount'>;
  commentCount?: number | null;
  favoriteOnly?: boolean;
}) {
  const { user, loading } = useSession();
  // Private favorite state never enters the public topic/session-storage cache.
  const [social, setSocial] = useState<z.infer<
    typeof topicSocialSchema
  > | null>(null);
  const mutationVersion = useRef(0);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [controller, setController] = useState<AbortController | null>(null);
  useEffect(() => {
    if (loading || (favoriteOnly && !user)) return;
    const request = new AbortController();
    setController(request);
    setSocial(null);
    saving.current = false;
    mutationVersion.current++;
    setBusy(false);
    setError('');
    let running = false;
    async function refresh() {
      if (document.hidden || running || saving.current) return;
      const version = mutationVersion.current;
      running = true;
      try {
        const value = await readApi(
          `/api/topics/${data.id}/social`,
          topicSocialSchema,
          request.signal,
        );
        if (!request.signal.aborted && version === mutationVersion.current) {
          setSocial(value);
          setError('');
        }
      } catch {
        if (!request.signal.aborted) setError('Activity could not be loaded.');
      } finally {
        running = false;
      }
    }
    const changed = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          topicId: string;
          userId: string;
          favorite: boolean;
        }>
      ).detail;
      if (detail.topicId !== data.id || detail.userId !== user?.id) return;
      mutationVersion.current++;
      setSocial((value) => ({
        visits: value?.visits ?? data.visits ?? 0,
        commentCount: value?.commentCount ?? data.commentCount ?? 0,
        favorite: detail.favorite,
      }));
    };
    window.addEventListener('thinkink:favorite-changed', changed);
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      request.abort();
      window.removeEventListener('thinkink:favorite-changed', changed);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [data.id, user?.id, loading, attempt, favoriteOnly]);
  async function favorite() {
    if (!social || busy || saving.current || !user || !controller) return;
    saving.current = true;
    mutationVersion.current++;
    setBusy(true);
    setError('');
    try {
      const value = await readApi(
        `/api/topics/${data.id}/social`,
        topicSocialSchema,
        controller.signal,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected: !social.favorite }),
        },
      );
      if (!controller.signal.aborted) {
        setSocial(value);
        window.dispatchEvent(
          new CustomEvent('thinkink:favorite-changed', {
            detail: {
              topicId: data.id,
              userId: user.id,
              favorite: value.favorite,
            },
          }),
        );
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : 'Could not save favorite.',
        );
    } finally {
      if (!controller.signal.aborted) {
        saving.current = false;
        setBusy(false);
      }
    }
  }
  const visits = social?.visits ?? data.visits;
  const comments = commentCount ?? data.commentCount ?? social?.commentCount;
  return (
    <>
      {!favoriteOnly && (
        <>
          <span
            className="topic-visit-count"
            aria-label={
              visits === undefined ? 'Loading visits' : `${visits} visits`
            }
            title="Visits"
          >
            <Eye size={17} aria-hidden="true" />
            <span>{visits ?? '—'}</span>
          </span>
          <a
            className="discussion-jump discussion-jump-count"
            href="#discussion"
            aria-label={
              comments === undefined
                ? 'Go to comments'
                : `Go to comments (${comments})`
            }
          >
            <MessageCircle size={17} aria-hidden="true" />
            <span>{comments ?? '—'}</span>
          </a>
        </>
      )}
      {user || loading ? (
        <button
          type="button"
          className={`discussion-jump favorite-toggle${social?.favorite ? ' is-selected' : ''}`}
          aria-label={
            social?.favorite ? 'Remove from favorites' : 'Add to favorites'
          }
          title={
            social?.favorite ? 'Remove from favorites' : 'Add to favorites'
          }
          aria-pressed={Boolean(social?.favorite)}
          disabled={busy || loading || !social}
          onClick={() => void favorite()}
        >
          <Star
            size={17}
            fill={social?.favorite ? 'currentColor' : 'none'}
            aria-hidden="true"
          />
        </button>
      ) : (
        <Link
          className="discussion-jump favorite-toggle"
          to="/login"
          aria-label="Log in to save favorites"
          title="Log in to save favorites"
        >
          <Star size={17} aria-hidden="true" />
        </Link>
      )}
      {error && (
        <span className="topic-action-error" role="alert">
          {error}{' '}
          <button
            className="text-action"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </span>
      )}
    </>
  );
}
