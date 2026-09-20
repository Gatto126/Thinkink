import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Star } from 'lucide-react';
import { favoriteListSchema } from '@thinkink/shared/contracts';
import type { z } from 'zod';
import { readApi } from '../api';
import { useSession } from '../auth/session';
import { AuthPrompt } from '../components/AuthPrompt';
import { TopicList } from '../components/TopicList';

function FavoriteList() {
  const [data, setData] = useState<z.infer<typeof favoriteListSchema> | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setData(null);
    void readApi(
      `/api/favorites?offset=${offset}`,
      favoriteListSchema,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Could not load favorites.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [offset, attempt]);
  return (
    <>
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button
            className="text-action"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry favorites
          </button>
        </div>
      )}
      {busy ? (
        <p role="status">Loading favorites…</p>
      ) : data?.items.length ? (
        <TopicList
          title="Saved topics"
          showHeading={false}
          type="favorites"
          loading={false}
          items={data.items}
        />
      ) : !error ? (
        <div className="favorites-empty">
          <Star size={28} aria-hidden="true" />
          <p>No saved topics yet.</p>
        </div>
      ) : null}
      {(offset > 0 || data?.hasMore) && (
        <nav className="content-pagination" aria-label="Favorite pages">
          <button
            className="text-button"
            disabled={busy || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
          >
            Previous
          </button>
          <button
            className="text-button"
            disabled={busy || !data?.hasMore}
            onClick={() => setOffset((n) => n + 20)}
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}
export function Favorites() {
  const { user, loading } = useSession();
  useEffect(() => {
    const title = document.title;
    document.title = 'Favorites — Thinkink';
    window.scrollTo(0, 0);
    return () => {
      document.title = title;
    };
  }, []);
  return (
    <main id="main" className="topic-page favorites-page">
      <div className="topic-heading">
        <Link className="back-link" to="/">
          <ArrowLeft size={13} />
          All topics
        </Link>
        <h1>Favorites</h1>
      </div>
      <div className="topic-stream">
        {loading ? (
          <p role="status">Loading your account…</p>
        ) : user ? (
          <FavoriteList key={user.id} />
        ) : (
          <AuthPrompt action="to see your saved topics" />
        )}
      </div>
    </main>
  );
}
