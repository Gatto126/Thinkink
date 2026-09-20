import { CommentLike } from './CommentLike';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  MessageCircle,
} from 'lucide-react';
import { z } from 'zod';
import {
  commentListSchema,
  commentLocationSchema,
  contentDeletedSchema,
} from '@thinkink/shared/contracts';
import type { CommentList } from '@thinkink/shared/contracts';
import { readApi } from '../api';
import { useSession } from '../auth/session';
import { AuthPrompt } from './AuthPrompt';

type Comment = CommentList['items'][number];
const emptyPage: CommentList = { items: [], hasMore: false, total: 0 };
const author = (comment: Comment) => comment.username ?? 'Deleted account';
function CommentAvatar({ name, src }: { name: string; src?: string | null }) {
  return (
    <span className="discussion-avatar" aria-hidden="true">
      {src ? <img src={src} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function commentTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ] as const) {
    if (seconds >= size)
      return format.format(-Math.floor(seconds / size), unit);
  }
  return 'Just now';
}

const commentsPath = (topicId: string, offset: number, threadId?: string) =>
  `/api/topics/${topicId}/comments?offset=${offset}&${threadId ? `thread=${threadId}` : 'threaded=true'}`;

function useComments(
  topicId: string,
  offset: number,
  revision: number | string,
  enabled = true,
  threadId?: string,
) {
  const session = useSession();
  const [data, setData] = useState<CommentList>(emptyPage);
  const pageKey = `${commentsPath(topicId, offset, threadId)}:${session.user?.id ?? 'anonymous'}`;
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    const controller = new AbortController();
    setLoading(true);
    async function load() {
      if (document.hidden || running) return;
      running = true;
      try {
        const value = await readApi(
          commentsPath(topicId, offset, threadId),
          commentListSchema,
          controller.signal,
        );
        if (!disposed) {
          setData(value);
          setLoadedKey(pageKey);
          setError('');
        }
      } catch (error) {
        if (!disposed)
          setError(
            error instanceof Error
              ? error.message
              : 'Comments could not be loaded.',
          );
      } finally {
        running = false;
        if (!disposed) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    const visibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [
    topicId,
    offset,
    session.user?.id,
    revision,
    enabled,
    threadId,
    attempt,
    pageKey,
  ]);
  return {
    data: loadedKey === pageKey ? data : emptyPage,
    loaded: loadedKey === pageKey,
    loading: loadedKey !== pageKey || loading,
    error,
    reload: () => setAttempt((value) => value + 1),
  };
}

function CommentComposer({
  topicId,
  parent,
  onPosted,
  onCancel,
}: {
  topicId: string;
  parent?: Comment;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const { user } = useSession();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const controller = useRef<AbortController | null>(null);
  const submission = useRef({
    id: crypto.randomUUID(),
    body: '',
    parentId: null as string | null,
  });
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (parent) input.current?.focus();
  }, [parent?.id]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = '0px';
    input.current.style.height = `${Math.min(input.current.scrollHeight, 144)}px`;
  }, [draft, parent?.id]);
  if (!user) return null;
  async function post() {
    if (busy || !draft.trim()) return;
    const body = draft.trim();
    const parentId = parent?.id ?? null;
    if (
      submission.current.body !== body ||
      submission.current.parentId !== parentId
    )
      submission.current = { id: crypto.randomUUID(), body, parentId };
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      await readApi(
        `/api/topics/${topicId}/comments`,
        z.object({ id: z.uuid() }),
        controller.current.signal,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submission.current),
        },
      );
      if (controller.current.signal.aborted) return;
      setDraft('');
      submission.current = {
        id: crypto.randomUUID(),
        body: '',
        parentId: null,
      };
      onPosted();
    } catch (error) {
      if (!controller.current.signal.aborted)
        setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  const inputId = parent ? `reply-body-${parent.id}` : 'comment-body';
  return (
    <form
      className={`comment-form comment-composer${parent ? ' thread-composer' : ''}${draft ? ' has-draft' : ''}`}
      aria-label={parent ? `Reply to ${author(parent)}` : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <CommentAvatar
        name={user.profile.username}
        src={user.profile.avatar?.src}
      />
      <label htmlFor={inputId} className="sr-only">
        {parent ? 'Your reply' : 'Add your perspective'}
      </label>
      <textarea
        ref={input}
        id={inputId}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError('');
        }}
        maxLength={5000}
        rows={1}
        required
        placeholder={parent ? `Reply to ${author(parent)}…` : 'Add a comment…'}
        disabled={busy}
      />
      <div className="comment-form-actions">
        <button
          type="button"
          className="text-action"
          aria-label={parent ? 'Cancel reply' : undefined}
          disabled={busy}
          onClick={() => {
            if (parent) onCancel?.();
            else {
              setDraft('');
              setError('');
              input.current?.blur();
            }
          }}
        >
          Cancel
        </button>
        <button
          className="pill-button"
          disabled={busy || !draft.trim()}
          aria-busy={busy}
        >
          {busy ? 'Posting…' : parent ? 'Post reply' : 'Post comment'}
        </button>
      </div>
      {error && (
        <p className="field-hint" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CommentBody({ comment }: { comment: Comment }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (expanded || !text.current) return;
    const element = text.current;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [comment.body, expanded]);
  return (
    <>
      <p
        ref={text}
        id={`comment-text-${comment.id}`}
        className={`comment-body${expanded ? '' : ' comment-body-clamped'}`}
      >
        {comment.body}
      </p>
      {overflowing && (
        <button
          type="button"
          className="text-action comment-read-more"
          aria-expanded={expanded}
          aria-controls={`comment-text-${comment.id}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function CommentCard({
  comment,
  onReply,
  onDeleted,
  parentVisible = false,
  showContext = true,
  actionsBefore,
}: {
  comment: Comment;
  onReply: (comment: Comment) => void;
  onDeleted: () => void;
  parentVisible?: boolean;
  showContext?: boolean;
  actionsBefore?: ReactNode;
}) {
  const { user } = useSession();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) deleteButton.current?.focus();
  }, [confirm]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    controller.current = new AbortController();
    try {
      await readApi(
        `/api/comments/${comment.id}`,
        contentDeletedSchema,
        controller.current.signal,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: true }),
        },
      );
      if (!controller.current.signal.aborted) {
        setConfirm(false);
        onDeleted();
      }
    } catch (error) {
      if (!controller.current.signal.aborted)
        setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  return (
    <article className="comment" id={`comment-${comment.id}`} tabIndex={-1}>
      <CommentAvatar name={author(comment)} src={comment.avatar} />
      <div className="comment-content">
        <div className="comment-heading">
          <strong>
            {comment.username ? `@${comment.username}` : 'Deleted account'}
          </strong>
          <time
            dateTime={comment.createdAt}
            title={new Date(comment.createdAt).toLocaleString('en', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          >
            {commentTime(comment.createdAt)}
          </time>
        </div>
        {user && comment.canDelete && (
          <details
            className="comment-menu"
            ref={menu}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.open = false;
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary
              aria-label={`Comment options by ${author(comment)}`}
              title="Comment options"
            >
              <MoreVertical size={18} aria-hidden="true" />
            </summary>
            <div className="comment-menu-panel">
              <button
                type="button"
                aria-label={`Delete comment by ${author(comment)}`}
                disabled={busy}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                  setConfirm(true);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete comment
              </button>
            </div>
          </details>
        )}
        {showContext && comment.parentId && (
          <div
            className="comment-context"
            title={comment.replyBody ?? undefined}
          >
            {parentVisible ? (
              <a href={`#comment-${comment.parentId}`}>To {comment.replyTo}</a>
            ) : (
              <span>To {comment.replyTo}</span>
            )}
          </div>
        )}
        <CommentBody comment={comment} />
        <div className="comment-actions">
          <CommentLike key={user?.id ?? 'anonymous'} comment={comment} />
          {actionsBefore}
          {user && (
            <button
              className="text-action"
              type="button"
              onClick={() => onReply(comment)}
            >
              Reply
            </button>
          )}
        </div>
        {confirm && (
          <div className="comment-confirm">
            <span>Delete this comment?</span>
            <button
              ref={deleteButton}
              className="text-action"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete permanently
            </button>
            <button
              className="text-action"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="field-hint">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function LoadError({ error, reload }: { error: string; reload: () => void }) {
  return error ? (
    <div className="comment-error">
      <p role="alert">{error}</p>
      <button className="text-action" onClick={reload}>
        Retry comments
      </button>
    </div>
  ) : null;
}

// Keep the contents mounted until the upward closing animation finishes.
// Measuring the inner element also handles replies arriving after a slow fetch.
function useReplyReveal(open: boolean, immediate: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    if (open && !present) {
      setPresent(true);
      return;
    }
    const element = panel.current;
    const inner = content.current;
    if (!element || !inner || !present) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    let disposed = false;
    const resize = () => {
      const from = element.getBoundingClientRect().height;
      const to = open ? inner.getBoundingClientRect().height : 0;
      animation?.cancel();
      element.style.height = `${to}px`;
      const finish = () => {
        if (disposed) return;
        element.style.overflow = open ? 'visible' : 'hidden';
        setSettled(open);
        if (!open) setPresent(false);
      };
      if (immediate || reduced.matches || Math.abs(to - from) < 1) {
        finish();
        return;
      }
      setSettled(false);
      element.style.overflow = 'hidden';
      animation = element.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      animation.onfinish = finish;
    };
    resize();
    const observer = new ResizeObserver(() => {
      if (
        open &&
        Math.abs(
          inner.getBoundingClientRect().height -
            parseFloat(element.style.height),
        ) > 1
      )
        resize();
    });
    observer.observe(inner);
    reduced.addEventListener('change', resize);
    return () => {
      disposed = true;
      element.style.height = `${element.getBoundingClientRect().height}px`;
      animation?.cancel();
      observer.disconnect();
      reduced.removeEventListener('change', resize);
    };
  }, [open, present, immediate]);
  return { panel, content, present, settled };
}

function CommentThread({
  topicId,
  root,
  onChanged,
  onDeleted,
  destination,
}: {
  topicId: string;
  root: Comment;
  onChanged: () => void;
  onDeleted: () => void;
  destination?: { commentId: string; replyOffset: number; key: string };
}) {
  const [mode, setMode] = useState<'all' | 'hidden'>('hidden');
  const expanded = mode === 'all';
  const reveal = useReplyReveal(expanded, Boolean(destination));
  useEffect(() => {
    if (destination && destination.commentId !== root.id) {
      setMode('all');
      setOffset(destination.replyOffset);
    }
  }, [destination, root.id]);
  const [replyTo, setReplyTo] = useState<Comment | undefined>();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);
  const latest = useRef<AbortController | null>(null);
  useEffect(() => () => latest.current?.abort(), []);
  const feed = useComments(
    topicId,
    offset,
    `${revision}:${root.replyCount ?? 0}`,
    expanded,
    root.id,
  );
  const count =
    expanded && feed.loaded && !feed.error
      ? feed.data.total
      : (root.replyCount ?? 0);
  const reply = (comment: Comment) => {
    setReplyTo(comment);
    setNotice('');
  };
  function changed() {
    setRevision((value) => value + 1);
    onChanged();
  }
  function posted() {
    setMode('all');
    setReplyTo(undefined);
    setNotice('Reply posted.');
    changed();
    // A long thread stays open at its last page after a new reply is submitted.
    latest.current?.abort();
    latest.current = new AbortController();
    const signal = latest.current.signal;
    void readApi(commentsPath(topicId, 0, root.id), commentListSchema, signal)
      .then((value) => {
        if (!signal.aborted)
          setOffset(
            Math.min(
              100000,
              Math.floor(Math.max(0, value.total - 1) / 50) * 50,
            ),
          );
      })
      .catch(() => {
        /* The regular thread refresh exposes load errors and retry. */
      });
    toggle.current?.focus({ preventScroll: true });
  }
  const visibleReplies = reveal.present && feed.loaded ? feed.data.items : [];
  const visible = reveal.present || Boolean(replyTo) || expanded;
  const toggleButton = count > 0 && (
    <button
      ref={toggle}
      className="thread-toggle text-action"
      aria-label={
        expanded
          ? 'Hide replies'
          : `Show ${count} ${count === 1 ? 'reply' : 'replies'}`
      }
      aria-expanded={expanded}
      aria-controls={`replies-${root.id}`}
      onClick={() => {
        setMode(expanded ? 'hidden' : 'all');
      }}
    >
      <span>
        {count} {count === 1 ? 'reply' : 'replies'}
      </span>
      {expanded ? (
        <ChevronUp size={14} aria-hidden="true" />
      ) : (
        <ChevronDown size={14} aria-hidden="true" />
      )}
    </button>
  );
  return (
    <li
      className="comment-thread"
      data-target-ready={
        destination &&
        (destination.commentId === root.id ||
          (expanded &&
            reveal.settled &&
            feed.data.items.some((item) => item.id === destination.commentId)))
          ? 'true'
          : undefined
      }
    >
      <CommentCard
        comment={root}
        onReply={reply}
        onDeleted={onDeleted}
        actionsBefore={toggleButton}
      />
      <div
        id={`replies-${root.id}`}
        className="comment-replies"
        role="region"
        aria-label={`Replies to ${author(root)}`}
        hidden={!visible}
      >
        <div
          ref={reveal.panel}
          className="reply-reveal"
          inert={!expanded}
          aria-hidden={!expanded}
        >
          <div ref={reveal.content} className="reply-reveal-content">
            <ol className="reply-list">
              {visibleReplies.map((comment) => (
                <li key={comment.id}>
                  <CommentCard
                    comment={comment}
                    onReply={reply}
                    showContext={comment.parentId !== root.id}
                    parentVisible={
                      comment.parentId === root.id ||
                      visibleReplies.some(
                        (item) => item.id === comment.parentId,
                      )
                    }
                    onDeleted={() => {
                      if (replyTo?.id === comment.id) setReplyTo(undefined);
                      if (feed.data.items.length === 1 && offset > 0)
                        setOffset((value) => Math.max(0, value - 50));
                      setNotice('Comment deleted.');
                      changed();
                    }}
                  />
                </li>
              ))}
            </ol>
            <LoadError
              error={expanded ? feed.error : ''}
              reload={feed.reload}
            />
            {expanded && feed.loading && !feed.data.items.length && (
              <p className="field-hint" role="status">
                Loading replies…
              </p>
            )}
            {expanded && (offset > 0 || feed.data.hasMore) && (
              <nav
                className="content-pagination thread-pagination"
                aria-label="Reply pages"
              >
                <button
                  className="text-button"
                  disabled={offset === 0 || feed.loading}
                  onClick={() => setOffset((value) => Math.max(0, value - 50))}
                >
                  Earlier replies
                </button>
                <button
                  className="text-button"
                  disabled={!feed.data.hasMore || feed.loading}
                  onClick={() => setOffset((value) => value + 50)}
                >
                  Later replies
                </button>
              </nav>
            )}
          </div>
        </div>
        {notice && (
          <p className="field-hint" role="status">
            {notice}
          </p>
        )}
        {replyTo && (
          <CommentComposer
            topicId={topicId}
            parent={replyTo}
            onPosted={posted}
            onCancel={() => {
              setReplyTo(undefined);
              toggle.current?.focus();
            }}
          />
        )}
      </div>
    </li>
  );
}

export function Discussion({
  initialTotal,
  topicId,
  onTotalChange,
}: {
  topicId: string;
  initialTotal?: number;
  onTotalChange?: (total: number) => void;
}) {
  const session = useSession();
  const location = useLocation();
  const section = useRef<HTMLElement>(null);
  const [destination, setDestination] = useState<
    | (z.infer<typeof commentLocationSchema> & {
        commentId: string;
        key: string;
      })
    | undefined
  >();
  const [linkError, setLinkError] = useState('');
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const commentId = location.hash.slice('#comment-'.length);
    setDestination(undefined);
    setLinkError('');
    if (
      !location.hash.startsWith('#comment-') ||
      !z.uuid().safeParse(commentId).success
    )
      return;
    void readApi(
      `/api/topics/${topicId}/comments?locate=${commentId}`,
      commentLocationSchema,
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setOffset(value.rootOffset);
        setDestination({ ...value, commentId, key: location.key });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLinkError(
            error instanceof Error
              ? error.message
              : 'This comment could not be found.',
          );
      });
    return () => controller.abort();
  }, [topicId, location.hash, location.key, linkAttempt]);
  useEffect(() => {
    if (!destination || !section.current) return;
    let done = false;
    let frame = 0;
    const highlight = () => {
      const element = document.getElementById(
        `comment-${destination.commentId}`,
      );
      if (
        done ||
        !element?.getClientRects().length ||
        element
          .closest('.comment-thread')
          ?.getAttribute('data-target-ready') !== 'true'
      )
        return;
      done = true;
      frame = requestAnimationFrame(() => {
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        element.focus({ preventScroll: true });
      });
    };
    const observer = new MutationObserver(highlight);
    observer.observe(section.current, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    highlight();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [destination]);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const feed = useComments(topicId, offset, revision);
  useEffect(() => {
    if (feed.loaded && !feed.loading && !feed.error)
      onTotalChange?.(feed.data.total);
  }, [feed.data.total, feed.loaded, feed.loading, feed.error, onTotalChange]);
  function changed() {
    setRevision((value) => value + 1);
  }
  return (
    <section
      className="topic-card topic-conversation reveal"
      ref={section}
      id="discussion"
      aria-labelledby="discussion-heading"
    >
      <div className="block-label">
        <h2 id="discussion-heading">Comments</h2>
        <span className="comment-count">
          <MessageCircle size={16} aria-hidden="true" />
          {feed.loaded ? feed.data.total : (initialTotal ?? '—')}
        </span>
      </div>
      {notice && (
        <p role="status" className="field-hint">
          {notice}
        </p>
      )}
      <LoadError
        error={linkError}
        reload={() => setLinkAttempt((value) => value + 1)}
      />
      <LoadError error={feed.error} reload={feed.reload} />
      {feed.loading && !feed.data.items.length ? (
        <p className="field-hint">Loading conversation…</p>
      ) : !feed.data.items.length && !feed.error ? (
        <div className="discussion-empty">
          <p>Be the first to start the conversation.</p>
        </div>
      ) : null}
      <ol className="comment-list">
        {feed.data.items.map((root) => (
          <CommentThread
            key={root.id}
            topicId={topicId}
            root={root}
            destination={
              destination?.rootId === root.id ? destination : undefined
            }
            onChanged={changed}
            onDeleted={() => {
              setNotice('Comment deleted.');
              if (feed.data.items.length === 1 && offset > 0)
                setOffset((value) => Math.max(0, value - 50));
              changed();
            }}
          />
        ))}
      </ol>
      {(offset > 0 || feed.data.hasMore) && (
        <nav className="content-pagination" aria-label="Comment pages">
          <button
            className="text-button"
            disabled={offset === 0 || feed.loading}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Newer comments
          </button>
          <button
            className="text-button"
            disabled={!feed.data.hasMore || feed.loading}
            onClick={() => setOffset((value) => value + 50)}
          >
            Older comments
          </button>
        </nav>
      )}
      {session.user ? (
        <CommentComposer
          topicId={topicId}
          onPosted={() => {
            setOffset(0);
            setNotice('');
            changed();
          }}
        />
      ) : (
        !session.loading && (
          <div className="comment-auth">
            <AuthPrompt action="to join the conversation" />
          </div>
        )
      )}
    </section>
  );
}
