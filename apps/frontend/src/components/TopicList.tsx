import { Link } from 'react-router-dom';
import { withoutCitationMarkers } from '@thinkink/shared/overview-text';
import { useLayoutEffect, useRef } from 'react';
import type { HomeData } from '@thinkink/shared/contracts';
import { attachRevealMotion } from '../animations/reveal';
import { prefetchTopic } from '../content-cache';
import { Eye, MessageCircle } from 'lucide-react';
import { TopicActions } from './TopicActions';
import { useSession } from '../auth/session';

const cardDate = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function TopicList({
  title,
  items,
  type,
  loading,
  showHeading = true,
}: {
  title: string;
  items: HomeData['latest'];
  type: 'latest' | 'popular' | 'favorites';
  loading: boolean;
  showHeading?: boolean;
}) {
  const section = useRef<HTMLElement>(null);
  const { user } = useSession();
  useLayoutEffect(() => {
    if (!section.current || loading) return;
    return attachRevealMotion(section.current.querySelectorAll('.reveal'));
  }, [loading, items]);
  return (
    <section
      className="topic-list-section"
      aria-label={title}
      aria-busy={loading}
      ref={section}
    >
      {showHeading && (
        <div className="section-heading">
          <h2>{title}</h2>
        </div>
      )}
      {!loading && items.length ? (
        <ol className="topic-list">
          {items.map((topic) => (
            <li key={topic.id} className="reveal">
              <Link
                to={`/topics/${topic.id}`}
                aria-labelledby={`topic-card-${type}-${topic.id}`}
                onPointerEnter={() => prefetchTopic(topic.id)}
                onFocus={() => prefetchTopic(topic.id)}
              >
                <div className="topic-list-heading">
                  <h3 id={`topic-card-${type}-${topic.id}`}>{topic.title}</h3>
                  <div className="topic-stats">
                    <span
                      title="Visits"
                      aria-label={`${topic.visits ?? '—'} visits`}
                    >
                      <Eye size={15} aria-hidden="true" />
                      {topic.visits ?? '—'}
                    </span>
                    <span
                      title="Comments"
                      aria-label={`${topic.commentCount ?? '—'} comments`}
                    >
                      <MessageCircle size={15} aria-hidden="true" />
                      {topic.commentCount ?? '—'}
                    </span>
                  </div>
                </div>
                {topic.excerpt && (
                  <p className="topic-card-excerpt">
                    {withoutCitationMarkers(topic.excerpt)}
                  </p>
                )}
                <div className="topic-card-meta">
                  <span>
                    Created by{' '}
                    <strong>
                      {topic.creatorUsername ?? 'Deleted account'}
                    </strong>
                  </span>
                  <span>
                    Created{' '}
                    <time dateTime={topic.createdAt}>
                      {cardDate.format(new Date(topic.createdAt))}
                    </time>
                  </span>
                  <span>
                    Updated{' '}
                    <time dateTime={topic.updatedAt ?? topic.createdAt}>
                      {cardDate.format(
                        new Date(topic.updatedAt ?? topic.createdAt),
                      )}
                    </time>
                  </span>
                </div>
              </Link>
              <div className="topic-card-favorite">
                <TopicActions
                  key={user?.id ?? 'guest'}
                  data={topic}
                  favoriteOnly
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div
          className={`empty-list ${loading ? 'list-skeleton' : 'reveal'}`}
          aria-label={loading ? 'Loading topics' : undefined}
        >
          <h3 aria-hidden={loading || undefined}>
            {type === 'latest'
              ? 'Every topic starts with a question.'
              : 'Interest brings topics to life.'}
          </h3>
          <p aria-hidden={loading || undefined}>
            {type === 'latest'
              ? 'New conversations will find their place here.'
              : 'The topics people return to will rise to the top.'}
          </p>
        </div>
      )}
    </section>
  );
}
