import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import {
  topicSchema,
  topicSuggestionsSchema,
  topicTitleSchema,
} from '@thinkink/shared/contracts';
import { ApiError, readApi } from '../api';
import { loadSession, useSession } from '../auth/session';
import { AuthPrompt } from './AuthPrompt';
import { rememberTopic, prefetchTopic } from '../content-cache';

export function TopicSearch({
  documentNavigation = false,
}: {
  documentNavigation?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{
    term: string;
    topics: typeof topicSuggestionsSchema._output.topics;
  } | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const session = useSession();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const creation = useRef<AbortController | null>(null);
  const submitted = useRef<string | null>(null);
  const navigate = useNavigate();
  const term = query.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const valid = topicTitleSchema.safeParse(term).success;
  // Keep the previous suggestions visible while the next request is pending.
  // Creation and implicit Enter navigation always require the current result.
  const topics = valid ? (results?.topics ?? []) : [];
  const ready = results?.term === term;
  const loading = valid && !ready && !error;
  const exact = ready
    ? topics.find((topic) => topic.title.toLowerCase() === term.toLowerCase())
    : undefined;
  const visible =
    open && (valid || Boolean(error)) && (!loading || topics.length > 0);

  function openTopic(id: string) {
    setOpen(false);
    input.current?.blur();
    const destination = `/topics/${id}`;
    if (documentNavigation) window.location.assign(destination);
    else void navigate(destination);
  }

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void readApi(
        `/api/topics/search?q=${encodeURIComponent(term)}`,
        topicSuggestionsSchema,
        controller.signal,
      )
        .then((value) => {
          if (controller.signal.aborted) return;
          setResults({ term, topics: value.topics });
          setActive(-1);
          if (submitted.current === term) {
            submitted.current = null;
            const exact = value.topics.find(
              (topic) => topic.title.toLowerCase() === term.toLowerCase(),
            );
            if (exact) openTopic(exact.id);
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            setError(
              error instanceof Error
                ? error.message
                : 'Search is temporarily unavailable.',
            );
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, valid, retry]);
  useEffect(() => () => creation.current?.abort(), []);

  // The bubble follows the shared header as it compacts, without shifting page content.
  // Keep it usable even when the mobile search field becomes very narrow.
  useLayoutEffect(() => {
    if (!visible || !form.current) return;
    const measure = () => {
      const rect = form.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? innerWidth;
      const viewportBottom =
        (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0);
      const width = Math.min(
        660,
        viewportWidth - 36,
        Math.max(rect.width, 440),
      );
      setPosition({
        width,
        left: Math.max(18, Math.min(rect.left, viewportWidth - width - 18)),
        top: rect.bottom + 8,
        maxHeight: Math.max(
          80,
          Math.min(420, viewportBottom - rect.bottom - 24),
        ),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form.current);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        submitted.current = null;
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('pointerdown', outside);
    };
  }, [visible]);
  useEffect(() => {
    if (active >= 0)
      panel.current
        ?.querySelector(`[id="topic-option-${active}"]`)
        ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function change(value: string) {
    creation.current?.abort();
    submitted.current = null;
    setCreating(false);
    setQuery(value);
    if (!value.trim()) setResults(null);
    setError('');
    setActive(-1);
    setRequiresAuth(false);
    setOpen(Boolean(value.trim()));
    if (error && value.normalize('NFKC').replace(/\s+/gu, ' ').trim() === term)
      setRetry((value) => value + 1);
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (term.length < 2) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!valid) {
      setError('Enter a topic between 2 and 160 characters.');
      return;
    }
    if (creating) return;
    const selected = topics[active] ?? exact;
    if (selected) openTopic(selected.id);
    else {
      if (loading) submitted.current = term;
      input.current?.focus();
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
      submitted.current = null;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (topics.length)
        setActive((index) =>
          event.key === 'ArrowDown'
            ? (index + 1) % topics.length
            : index <= 0
              ? topics.length - 1
              : index - 1,
        );
    }
  }
  async function create() {
    if (!valid || !ready || exact || creating || !session.user || requiresAuth)
      return;
    // Keep focus inside the bubble when the action is disabled or replaced by
    // the sign-in prompt after an expired session.
    input.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    creation.current = controller;
    setCreating(true);
    setError('');
    try {
      const topic = await readApi(
        '/api/topics',
        topicSchema,
        controller.signal,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: term }),
        },
      );
      if (!controller.signal.aborted) {
        rememberTopic(topic);
        openTopic(topic.id);
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        error instanceof ApiError &&
        error.status === 401
      ) {
        setRequiresAuth(true);
        await loadSession();
      } else if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      if (!controller.signal.aborted) setCreating(false);
    }
  }

  return (
    <div
      className="header-search"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
          submitted.current = null;
        }
      }}
    >
      <form className="search-form" role="search" ref={form} onSubmit={search}>
        <Search size={20} strokeWidth={1.8} aria-hidden="true" />
        <label className="sr-only" htmlFor="topic-search">
          Search a topic
        </label>
        <input
          id="topic-search"
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls="topic-suggestions"
          aria-activedescendant={
            visible && active >= 0 ? `topic-option-${active}` : undefined
          }
          aria-describedby={visible ? 'search-status' : undefined}
          autoComplete="off"
          value={query}
          maxLength={160}
          onChange={(event) => change(event.target.value)}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="What do you think…"
        />
        {query && (
          <button
            className="search-clear"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              input.current?.focus();
              change('');
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
        <button
          className="search-submit"
          aria-label="Search topics"
          disabled={creating}
        >
          <ArrowRight size={22} aria-hidden="true" />
        </button>
      </form>
      {visible && (
        <div className="search-popover" ref={panel} style={position}>
          <p
            className={
              error ? 'search-status search-status--error' : 'search-status'
            }
            id="search-status"
            role={error ? 'alert' : 'status'}
          >
            {error ||
              (topics.length
                ? 'Suggested topics'
                : 'A new conversation starts here.')}
          </p>
          <ul
            id="topic-suggestions"
            className="search-suggestions"
            role="listbox"
            aria-label="Topic suggestions"
            aria-busy={loading}
          >
            {!error &&
              topics.map((topic, index) => (
                <li key={topic.id} role="presentation">
                  <Link
                    id={`topic-option-${index}`}
                    role="option"
                    aria-selected={active === index}
                    tabIndex={-1}
                    to={`/topics/${topic.id}`}
                    reloadDocument={documentNavigation}
                    onPointerEnter={() => prefetchTopic(topic.id)}
                    onFocus={() => prefetchTopic(topic.id)}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => setActive(index)}
                    onClick={() => {
                      setOpen(false);
                      input.current?.blur();
                    }}
                  >
                    <Search size={17} aria-hidden="true" />
                    <span>{topic.title}</span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ul>
          {!error && ready && !exact && (
            <div
              className={`search-result${!session.loading && session.user && !requiresAuth ? ' search-result--create' : ''}`}
              id="search-result"
            >
              <p>
                No topic yet for <strong>{term}</strong>.
              </p>
              {session.loading ? (
                <p className="auth-prompt">Checking your session…</p>
              ) : session.user && !requiresAuth ? (
                <button
                  className="text-action"
                  type="button"
                  disabled={creating}
                  onClick={() => void create()}
                >
                  {creating ? 'Preparing topic…' : 'Start this topic'}{' '}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <AuthPrompt
                  action="to start a new topic"
                  documentNavigation={documentNavigation}
                />
              )}
            </div>
          )}
          {error && valid && (
            <button
              className="text-action search-retry"
              type="button"
              onClick={() => {
                setError('');
                setResults(null);
                setRetry((value) => value + 1);
              }}
            >
              Try again <ArrowRight size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
