import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, Trash2 } from 'lucide-react';
import {
  contentDeletedSchema,
  moderationUsersSchema,
} from '@thinkink/shared/contracts';
import { readApi } from '../api';
import { forgetAllContent } from '../content-cache';

type ManagedUser = (typeof moderationUsersSchema._output.items)[number];

function UserCard({
  user,
  onDeleted,
}: {
  user: ManagedUser;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trash = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const name = user.username ?? user.email ?? 'User';
  async function remove() {
    if (busy) return;
    controller.current = new AbortController();
    setBusy(true);
    setError('');
    try {
      await readApi(
        `/api/moderation/users/${user.id}`,
        contentDeletedSchema,
        controller.current.signal,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      forgetAllContent();
      onDeleted();
    } catch (error) {
      if (!controller.current.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Please try again.');
        setBusy(false);
      }
    }
  }
  return (
    <article className="managed-card managed-user">
      <div className="managed-card-heading">
        <div>
          <h3>{name}</h3>
          <p className="field-hint">{user.email ?? 'No email address'}</p>
          <p className="field-hint">
            {user.isModerator ? 'Admin' : 'Member'}
            {user.isCurrentUser && ' · Your account'}
            {' · Joined '}
            <time dateTime={user.createdAt}>
              {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
                new Date(user.createdAt),
              )}
            </time>
          </p>
        </div>
        {!user.isCurrentUser && (
          <button
            ref={trash}
            type="button"
            className="content-trash"
            aria-label={`Delete user: ${name}`}
            aria-expanded={confirming}
            disabled={busy}
            onClick={() => setConfirming((value) => !value)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="field-hint">
        {user.topicCount} {user.topicCount === 1 ? 'topic' : 'topics'} ·{' '}
        {user.commentCount} {user.commentCount === 1 ? 'comment' : 'comments'}
      </p>
      {confirming && (
        <div
          className="content-confirm"
          role="group"
          aria-label={`Confirm deletion of ${name}`}
        >
          <p>
            Permanently delete {name} and their account, all their topics and
            all their comments? Comments by other people on their topics will
            also be removed. This cannot be undone.
          </p>
          <div className="content-confirm-actions">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError('');
                trash.current?.focus();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="delete-account-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? 'Deleting…' : 'Delete user permanently'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}

export function UserManager() {
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void readApi(
      `/api/moderation/users?offset=${offset}&q=${encodeURIComponent(filter)}`,
      moderationUsersSchema,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setItems(value.items);
          setHasMore(value.hasMore);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Please try again.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, filter, attempt]);
  function deleted() {
    setNotice('User, their topics and comments deleted.');
    setLoading(true);
    if (items.length === 1 && offset > 0)
      setOffset((value) => Math.max(0, value - 50));
    else setAttempt((value) => value + 1);
    heading.current?.focus({ preventScroll: true });
  }
  return (
    <section className="content-manager" aria-label="Manage users">
      <h2 ref={heading} tabIndex={-1}>
        Registered users
      </h2>
      <p className="field-hint">
        Review registered accounts. Deleting a user also removes all their
        topics and comments.
      </p>
      <form
        className="moderation-search"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setFilter(query.trim());
          setAttempt((value) => value + 1);
        }}
      >
        <label className="sr-only" htmlFor="user-query">
          Search users
        </label>
        <input
          id="user-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={160}
          placeholder="Search username or email"
        />
        <button type="submit" className="icon-button" aria-label="Search users">
          <Search size={18} />
        </button>
      </form>
      <p className="field-hint" role="status">
        {notice}
      </p>
      {loading ? (
        <p className="field-hint" role="status">
          Loading users…
        </p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="managed-cards">
            {items.map((user) => (
              <UserCard key={user.id} user={user} onDeleted={deleted} />
            ))}
          </div>
          {!items.length && <p className="content-empty">No users found.</p>}
          {(offset > 0 || hasMore) && (
            <nav className="content-pagination" aria-label="User pages">
              <button
                className="text-button"
                disabled={offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                Previous
              </button>
              <span className="field-hint">Page {offset / 50 + 1}</span>
              <button
                className="text-button"
                disabled={!hasMore}
                onClick={() => setOffset((value) => value + 50)}
              >
                Next <ArrowRight size={14} />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
