import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { reactionSchema } from '@thinkink/shared/contracts';
import type { CommentList } from '@thinkink/shared/contracts';
import { useSession } from '../auth/session';
import { readApi } from '../api';

export function CommentLike({
  comment,
}: {
  comment: CommentList['items'][number];
}) {
  const { user, loading } = useSession();
  const [selection, setSelection] = useState<{
    liked: boolean;
    likeCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setSelection(null);
    setBusy(false);
    setError('');
    return () => controller.current?.abort();
  }, [user?.id, comment.id]);
  useEffect(() => {
    setSelection(null);
  }, [comment.liked, comment.likeCount]);
  const liked = Boolean(user && (selection?.liked ?? comment.liked));
  const count = selection?.likeCount ?? comment.likeCount ?? 0;
  async function toggle() {
    if (busy || !user) return;
    setBusy(true);
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      const value = await readApi(
        `/api/comments/${comment.id}/like`,
        reactionSchema,
        request.signal,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected: !liked }),
        },
      );
      if (!request.signal.aborted) setSelection(value);
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  const icon = (
    <>
      <Heart
        size={15}
        fill={liked ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      <span>{count}</span>
    </>
  );
  return (
    <>
      {user || loading ? (
        <button
          type="button"
          className={`text-action comment-like${liked ? ' is-selected' : ''}`}
          aria-label={liked ? 'Unlike comment' : 'Like comment'}
          aria-pressed={liked}
          disabled={busy || loading}
          onClick={() => void toggle()}
        >
          {icon}
        </button>
      ) : (
        <Link
          className="text-action comment-like"
          to="/login"
          aria-label="Log in to like this comment"
        >
          {icon}
        </Link>
      )}
      {error && (
        <span className="reaction-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
