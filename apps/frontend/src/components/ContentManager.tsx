import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pencil, Search, Trash2 } from 'lucide-react';
import {
  contentDeletedSchema,
  moderationListSchema,
} from '@thinkink/shared/contracts';
import { readApi } from '../api';
import { forgetTopic, prefetchTopic } from '../content-cache';

type ManagedItem = (typeof moderationListSchema._output.items)[number];
type Mode = 'own' | 'topics' | 'comments';

function ContentCard({
  item,
  mode,
  onDeleted,
}: {
  item: ManagedItem;
  mode: Mode;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trash = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const comment = mode === 'comments';
  async function remove() {
    if (busy) return;
    controller.current = new AbortController();
    setBusy(true);
    setError('');
    try {
      await readApi(
        comment
          ? `/api/moderation/comments/${item.id}`
          : `/api/topics/${item.id}`,
        contentDeletedSchema,
        controller.current.signal,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      if (!comment) forgetTopic(item.topicId);
      onDeleted();
    } catch (error) {
      if (!controller.current.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Please try again.');
        setBusy(false);
      }
    }
  }
  return (
    <article className="managed-card">
      <div className="managed-card-heading">
        <div>
          <h3>
            <Link
              to={`/topics/${item.topicId}`}
              onPointerEnter={() => prefetchTopic(item.topicId)}
              onFocus={() => prefetchTopic(item.topicId)}
            >
              {item.title}
            </Link>
          </h3>
          <time className="timestamp" dateTime={item.createdAt}>
            {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(
              new Date(item.createdAt),
            )}
          </time>
        </div>
        <div className="managed-card-actions">
          {mode === 'topics' && (
            <Link
              className="content-edit"
              to={`/topics/${item.topicId}?edit=overview`}
              aria-label={`Edit overview: ${item.title}`}
              title="Edit overview"
              onPointerEnter={() => prefetchTopic(item.topicId)}
              onFocus={() => prefetchTopic(item.topicId)}
            >
              <Pencil size={18} aria-hidden="true" />
            </Link>
          )}
          <button
            ref={trash}
            type="button"
            className="content-trash"
            aria-label={`Delete ${comment ? 'comment' : 'topic'}: ${item.title}`}
            aria-expanded={confirming}
            disabled={busy}
            onClick={() => setConfirming((value) => !value)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      {comment && <p className="managed-comment">{item.body}</p>}
      {confirming && (
        <div
          className="content-confirm"
          role="group"
          aria-label="Confirm deletion"
        >
          <p>
            {comment
              ? 'Permanently delete this comment?'
              : 'Permanently delete this topic and all its comments?'}{' '}
            This cannot be undone.
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
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
}

export function ContentManager({ mode }: { mode: Mode }) {
  const [items, setItems] = useState<ManagedItem[]>([]);
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
    const path =
      mode === 'own' ? '/api/account/topics' : `/api/moderation/${mode}`;
    void readApi(
      `${path}?offset=${offset}&q=${encodeURIComponent(filter)}`,
      moderationListSchema,
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
  }, [mode, offset, filter, attempt]);
  function deleted() {
    setNotice(
      mode === 'comments'
        ? 'Comment deleted.'
        : 'Topic and its comments deleted.',
    );
    setLoading(true);
    if (items.length === 1 && offset > 0)
      setOffset((value) => Math.max(0, value - 50));
    else setAttempt((value) => value + 1);
    heading.current?.focus({ preventScroll: true });
  }
  return (
    <section
      className="content-manager"
      aria-label={mode === 'own' ? 'Your topics' : `Manage ${mode}`}
    >
      <h2 ref={heading} tabIndex={-1}>
        {mode === 'own'
          ? 'Your topics'
          : mode === 'comments'
            ? 'Comments'
            : 'Topics'}
      </h2>
      <p className="field-hint">
        {mode === 'own'
          ? 'The conversations you started. Deleting a topic also removes all its comments.'
          : 'Review content and remove it when needed.'}
      </p>
      {mode === 'comments' && (
        <form
          className="moderation-search"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setFilter(query.trim());
            setAttempt((value) => value + 1);
          }}
        >
          <label className="sr-only" htmlFor="moderation-query">
            Search {mode}
          </label>
          <input
            id="moderation-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={160}
            placeholder={`Search ${mode}`}
          />
          <button
            type="submit"
            className="icon-button"
            aria-label={`Search ${mode}`}
          >
            <Search size={18} />
          </button>
        </form>
      )}
      <p className="field-hint" role="status">
        {notice}
      </p>
      {loading ? (
        <p className="field-hint" role="status">
          Loading {mode === 'comments' ? 'comments' : 'topics'}…
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
            {items.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                mode={mode}
                onDeleted={deleted}
              />
            ))}
          </div>
          {!items.length && (
            <p className="content-empty">
              {mode === 'own'
                ? 'You haven’t started any topics yet.'
                : 'No content found.'}
            </p>
          )}
          {(offset > 0 || hasMore) && (
            <nav className="content-pagination" aria-label="Content pages">
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
