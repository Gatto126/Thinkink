import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { homeSchema } from '@thinkink/shared/contracts';
import type { HomeData } from '@thinkink/shared/contracts';
import { PRODUCTION_INTERVALS } from '@thinkink/shared/timing';
import { readApi } from '../api';
import { TopicList } from '../components/TopicList';
import { PerspectiveArt } from '../components/PerspectiveArt';
import { cachedHome, rememberHome } from '../content-cache';

export function Home() {
  const [data, setData] = useState<HomeData>(
    () => cachedHome() ?? { latest: [], mostVisited: [] },
  );
  const [loading, setLoading] = useState(() => !cachedHome());
  const [error, setError] = useState('');

  useEffect(() => {
    let controller: AbortController | undefined;
    let disposed = false;
    async function refresh() {
      if (document.hidden) return;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const result = await readApi(
          '/api/home',
          homeSchema,
          requestController.signal,
        );
        if (!disposed) {
          rememberHome(result);
          setData(result);
          setError('');
        }
      } catch (error) {
        if (!disposed && !requestController.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'Topics could not be loaded.',
          );
      } finally {
        if (!disposed && !requestController.signal.aborted) setLoading(false);
      }
    }
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, PRODUCTION_INTERVALS.homeMs);
    const onVisibility = () => {
      if (!document.hidden) void refresh();
      else controller?.abort();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <main id="main" className="home-page">
      <section className="home-hero">
        <div className="home-intro">
          <h1>Stay curious.</h1>
        </div>
        <PerspectiveArt className="home-art" />
      </section>
      <div className="catalogue" id="topics">
        <p className="catalogue-notice" role="status">
          {error && (
            <>
              <CircleHelp size={15} />
              {error}
            </>
          )}
        </p>
        <div className="topic-sections">
          <TopicList
            title="Hot Topic"
            items={data.mostVisited.slice(0, 3)}
            type="popular"
            loading={loading}
          />
          <TopicList
            title="Latest topic"
            items={data.latest.slice(0, 1)}
            type="latest"
            loading={loading}
          />
        </div>
      </div>
      <div className="home-mission-link">
        <a href="/mission/">Meet Thinkink</a>
      </div>
    </main>
  );
}
