import { withoutCitationMarkers } from '@thinkink/shared/overview-text';
import { TopicActions } from '../components/TopicActions';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Newspaper,
  Pencil,
  Sparkles,
} from 'lucide-react';
import {
  topicSchema,
  contentPermissionsSchema,
} from '@thinkink/shared/contracts';
import type { TopicData } from '@thinkink/shared/contracts';
import { ApiError, readApi } from '../api';
import { cachedTopic, loadTopic, rememberTopic } from '../content-cache';
import { attachRevealMotion } from '../animations/reveal';
import { useSession } from '../auth/session';
import { Discussion } from '../components/Discussion';
import { PublisherIcon } from '../components/PublisherIcon';
import { useTopicVisit } from '../components/useTopicVisit';
import { OverviewEditor } from '../components/OverviewEditor';

type Source = TopicData['news'][number];
function timeLabel(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function NewsImage({
  sources,
  onUnavailable,
}: {
  sources: string[];
  onUnavailable?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const src = sources[index];
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  useEffect(() => {
    if (!src) {
      unavailable.current?.();
      return;
    }
    if (ready) return;
    const timer = window.setTimeout(() => {
      setReady(false);
      setIndex((i) => i + 1);
    }, 8000);
    return () => clearTimeout(timer);
  }, [src, ready]);
  const next = () => {
    setReady(false);
    setIndex((i) => i + 1);
  };
  return (
    <div className="news-image-frame">
      {!src ? (
        <Newspaper size={24} aria-hidden="true" />
      ) : (
        <img
          key={src}
          className="news-image"
          src={src}
          alt=""
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ visibility: ready ? 'visible' : 'hidden' }}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth >= 640 && image.naturalHeight >= 360)
              setReady(true);
            else next();
          }}
          onError={next}
        />
      )}
    </div>
  );
}
function articleImages(article: Source): string[] {
  return [
    ...new Set([
      ...(article.imageCandidates ?? []),
      ...(article.imageUrl ? [article.imageUrl] : []),
    ]),
  ].slice(0, 6);
}
function NewsGrid({ articles }: { articles: Source[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const lead =
    articles.find(
      (article) =>
        !failed.includes(article.id) && articleImages(article).length,
    ) ?? articles[0];
  if (!lead) return null;
  const remaining = articles.filter((article) => article.id !== lead.id);
  return (
    <div className={`news-grid${remaining.length ? '' : ' news-grid--single'}`}>
      <Article
        key={lead.id}
        article={lead}
        featured
        failedImage={failed.includes(lead.id)}
        onImageUnavailable={() =>
          setFailed((ids) => (ids.includes(lead.id) ? ids : [...ids, lead.id]))
        }
      />
      {remaining.length > 0 && (
        <div className="news-secondary">
          {remaining.map((article) => (
            <Article key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}

function Article({
  article,
  featured = false,
  onImageUnavailable,
  failedImage = false,
}: {
  article: Source;
  featured?: boolean;
  onImageUnavailable?: () => void;
  failedImage?: boolean;
}) {
  return (
    <article
      className={featured ? 'news-story news-story--lead' : 'news-story'}
    >
      {featured && articleImages(article).length > 0 && (
        <NewsImage
          key={articleImages(article).join('|')}
          sources={failedImage ? [] : articleImages(article)}
          onUnavailable={onImageUnavailable}
        />
      )}
      <p className="article-meta">
        <PublisherIcon
          key={article.url}
          url={article.url}
          name={article.publisher ?? new URL(article.url).hostname}
        />
        {article.publisher ?? 'Original reporting'}
      </p>
      <h3>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {article.title}
          <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </h3>
      <p className="article-date timestamp">
        {article.publishedAt ? (
          <time
            dateTime={article.publishedAt}
            title={
              article.publishedAtEstimated
                ? 'Estimated from the source’s relative date at retrieval'
                : 'Publication date'
            }
          >
            {article.publishedAtEstimated ? '≈ ' : ''}
            {timeLabel(article.publishedAt)}
            {article.publishedAtEstimated && (
              <span className="sr-only"> (estimated)</span>
            )}
          </time>
        ) : article.publishedDateLabel ? (
          `${article.publishedDateLabel} · Time unavailable`
        ) : (
          'Publication date unavailable'
        )}
      </p>
    </article>
  );
}

function TopicContent({
  data,
  onPrepared,
}: {
  data: TopicData;
  onPrepared: (value: TopicData) => void;
}) {
  const session = useSession();
  useTopicVisit(data.id);
  const [editing, setEditing] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [editNotice, setEditNotice] = useState('');
  useEffect(() => {
    if (searchParams.get('edit') !== 'overview' || session.loading) return;
    if (session.user?.isModerator) {
      if (data.summary) setEditing(true);
      else
        setEditNotice('An overview must be generated before it can be edited.');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('edit');
    setSearchParams(next, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    session.loading,
    session.user?.isModerator,
    data.summary,
  ]);
  const editButton = useRef<HTMLButtonElement>(null);
  const [canPrepare, setCanPrepare] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [, updateRetryClock] = useState(0);
  useEffect(() => {
    if (!data.contentRetryAt) return;
    const delay = Date.parse(data.contentRetryAt) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => updateRetryClock((value) => value + 1),
      Math.min(delay + 50, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [data.contentRetryAt]);
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setCanPrepare(false);
    if (session.user && data.contentStatus !== 'ready') {
      void readApi(
        `/api/topics/${data.id}/permissions`,
        contentPermissionsSchema,
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted) setCanPrepare(value.canDelete);
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [data.id, data.contentStatus, session.user?.id]);
  async function prepare() {
    preparation.current = new AbortController();
    setPreparing(true);
    setPrepareError('');
    try {
      const value = await readApi(
        `/api/topics/${data.id}/prepare`,
        topicSchema,
        preparation.current.signal,
        { method: 'POST' },
      );
      onPrepared(value);
      if (value.contentStatus === 'idle')
        setPrepareError('Content preparation is not available yet.');
    } catch (error) {
      if (!preparation.current.signal.aborted)
        setPrepareError(
          error instanceof Error ? error.message : 'Please try again.',
        );
    } finally {
      setPreparing(false);
    }
  }
  const content = useRef<HTMLDivElement>(null);
  const date = data.summary?.generatedAt ?? data.createdAt;
  useEffect(() => {
    if (content.current)
      return attachRevealMotion(content.current.querySelectorAll('.reveal'));
  }, [data]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${data.title} — Thinkink`;
    return () => {
      document.title = previous;
    };
  }, [data.title]);
  return (
    <>
      <div className="topic-heading">
        <Link className="back-link" to="/">
          <ArrowLeft size={13} /> All topics
        </Link>
        <h1>{data.title}</h1>
      </div>
      <div className="topic-stream" ref={content}>
        <article
          className="topic-card reveal"
          aria-label="Topic overview and news"
        >
          <div className="topic-card-meta">
            {date ? (
              <div className="topic-date">
                <CalendarDays size={17} aria-hidden="true" />
                <span>
                  {data.summary ? 'Overview generated' : 'Topic started'}
                  <time dateTime={date}>{timeLabel(date)}</time>
                </span>
              </div>
            ) : (
              <span className="timestamp">Following the story</span>
            )}
            <div className="topic-card-actions">
              {session.user?.isModerator && data.summary && (
                <button
                  ref={editButton}
                  type="button"
                  className="discussion-jump"
                  aria-label="Edit overview"
                  aria-expanded={editing}
                  disabled={editing}
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
              )}
              <TopicActions
                key={session.user?.id ?? 'anonymous'}
                data={data}
                commentCount={commentCount}
              />
            </div>
          </div>
          <section
            className="topic-overview"
            aria-labelledby="overview-heading"
          >
            {editNotice && (
              <p className="field-hint" role="status">
                {editNotice}
              </p>
            )}
            {editing && data.summary && session.user?.isModerator ? (
              <OverviewEditor
                key={data.summary.id}
                topicId={data.id}
                summary={data.summary}
                onCancel={() => {
                  setEditing(false);
                  requestAnimationFrame(() => editButton.current?.focus());
                }}
                onSaved={(summary) => {
                  onPrepared({ ...data, summary });
                  setEditing(false);
                  requestAnimationFrame(() => editButton.current?.focus());
                }}
              />
            ) : (
              <>
                <h2 id="overview-heading">
                  {data.summary?.headline ??
                    (preparing || data.contentStatus === 'preparing'
                      ? 'Preparing your overview…'
                      : data.summary || data.contentStatus === 'idle'
                        ? 'The story so far.'
                        : 'Overview not available yet')}
                </h2>
                {data.summary ? (
                  <>
                    {data.summary.paragraphs?.length ? (
                      <div className="overview-text">
                        {data.summary.paragraphs.map((paragraph, index) => (
                          <p key={index}>
                            {withoutCitationMarkers(paragraph.text)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="overview-text">
                        {withoutCitationMarkers(data.summary.text)}
                      </p>
                    )}
                    <p className="ai-credit">
                      <Sparkles size={12} aria-hidden="true" /> AI overview
                      {data.summary.model && (
                        <span>· {data.summary.model}</span>
                      )}
                      {data.summary.editedAt && (
                        <span
                          title={`Edited ${timeLabel(data.summary.editedAt)}`}
                        >
                          · edit by admin
                        </span>
                      )}
                    </p>
                    <details className="summary-sources">
                      <summary>
                        Sources behind this overview{' '}
                        <span>{data.summary.sources.length}</span>
                      </summary>
                      <ul>
                        {data.summary.sources.map((source) => (
                          <li key={source.id}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {source.title}
                              <ArrowUpRight size={13} aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                ) : (
                  <div className="topic-waiting">
                    {(preparing || data.contentStatus === 'preparing') && (
                      <p>Gathering sources and preparing your overview…</p>
                    )}
                    {data.contentStatus === 'idle' ? (
                      <p>
                        This topic is saved. An overview and its sources will
                        appear here when available.
                      </p>
                    ) : data.contentStatus === 'empty' ? (
                      <p>
                        No relevant articles were returned for this topic. We
                        won’t invent an overview.
                      </p>
                    ) : data.contentStatus === 'paused' ? (
                      <p>
                        The AI overview is temporarily unavailable. You can read
                        the saved articles below.
                      </p>
                    ) : ['partial', 'error'].includes(data.contentStatus) ? (
                      <p>
                        The overview could not be completed. Any articles
                        already found are saved below.
                      </p>
                    ) : null}
                    {canPrepare && data.contentStatus !== 'preparing' && (
                      <>
                        {data.contentRetryAt &&
                        Date.parse(data.contentRetryAt) > Date.now() ? (
                          <p>
                            Preparation can be retried after{' '}
                            {timeLabel(data.contentRetryAt)}.
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="text-action"
                            disabled={preparing}
                            onClick={() => void prepare()}
                          >
                            {preparing
                              ? 'Preparing…'
                              : data.contentStatus === 'idle'
                                ? 'Prepare this topic'
                                : 'Retry preparation'}{' '}
                            <ArrowRight size={14} />
                          </button>
                        )}
                      </>
                    )}
                    {prepareError && <p role="alert">{prepareError}</p>}
                  </div>
                )}
              </>
            )}
          </section>
          <section className="topic-news" aria-labelledby="news-heading">
            <div className="news-heading">
              <h2 id="news-heading">Latest news</h2>
              {data.newsCheckedAt && (
                <span className="timestamp">
                  Checked {timeLabel(data.newsCheckedAt)}
                </span>
              )}
            </div>
            {data.summary && (
              <p className="section-description">
                Original reporting and sources for this topic.
              </p>
            )}
            {data.news.length ? (
              <NewsGrid
                key={`${data.id}:${data.newsRevision}`}
                articles={data.news}
              />
            ) : (
              <p className="news-empty">
                <Newspaper size={18} aria-hidden="true" />
                No articles are available for this topic yet.
              </p>
            )}
          </section>
        </article>
        <Discussion
          initialTotal={data.commentCount}
          topicId={data.id}
          onTotalChange={setCommentCount}
        />
      </div>
    </>
  );
}

export function Topic() {
  const { id } = useParams();
  return <TopicPage key={id} id={id?.toLowerCase() ?? ''} />;
}
function TopicPage({ id }: { id: string }) {
  const [data, setData] = useState<TopicData | null>(() => cachedTopic(id));
  function onPrepared(value: TopicData) {
    rememberTopic(value);
    setData(value);
  }
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [id]);
  useEffect(() => {
    if (data?.contentStatus !== 'preparing') return;
    const controller = new AbortController();
    let running = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || running) return;
      running = true;
      void readApi(`/api/topics/${data.id}`, topicSchema, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            rememberTopic(value);
            setData(value);
          }
        })
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    }, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [data?.id, data?.contentStatus]);
  useEffect(() => {
    let disposed = false;
    setError('');
    void loadTopic(id)
      .then((value) => {
        if (!disposed) setData(value);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          if (error instanceof ApiError && error.status === 404) setData(null);
          setError(
            error instanceof Error
              ? error.message
              : 'This topic could not be loaded.',
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [id]);
  if (error && !data)
    return (
      <main id="main" className="status-page">
        <span className="eyebrow">A MOMENT, PLEASE</span>
        <h1>
          This conversation
          <br />
          <em>is still ahead of us.</em>
        </h1>
        <p role="alert">{error}</p>
        <Link className="pill-button" to="/">
          Back to explore <ArrowRight size={17} />
        </Link>
      </main>
    );
  if (!data || data.id !== id?.toLowerCase())
    return (
      <main
        id="main"
        className="topic-page topic-loading"
        aria-busy="true"
        aria-label="Loading topic"
      >
        <div className="topic-heading" aria-hidden="true">
          <span className="topic-placeholder topic-placeholder--back" />
          <span className="topic-placeholder topic-placeholder--title" />
        </div>
        <div className="topic-card topic-placeholder-card" aria-hidden="true">
          <span className="topic-placeholder topic-placeholder--date" />
          <span className="topic-placeholder topic-placeholder--headline" />
          <div className="topic-placeholder-lines">
            <span className="topic-placeholder" />
            <span className="topic-placeholder" />
            <span className="topic-placeholder" />
          </div>
          <div className="topic-placeholder-news">
            <span className="topic-placeholder" />
            <span className="topic-placeholder" />
          </div>
        </div>
      </main>
    );
  return (
    <main id="main" className="topic-page">
      <TopicContent key={data.id} data={data} onPrepared={onPrepared} />
    </main>
  );
}
