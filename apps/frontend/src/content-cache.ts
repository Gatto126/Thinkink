import { homeSchema, topicSchema } from '@thinkink/shared/contracts';
import type { HomeData, TopicData } from '@thinkink/shared/contracts';
import { ApiError, readApi } from './api';

// Public content only. Session storage also survives the static Mission page.
const prefix = 'thinkink:content:v1:';
const maxAge = 30 * 60_000;
function read(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(prefix + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return typeof entry.savedAt === 'number' &&
      Date.now() - entry.savedAt < maxAge
      ? entry.data
      : null;
  } catch {
    return null;
  }
}
function save(key: string, data: unknown) {
  try {
    sessionStorage.setItem(
      prefix + key,
      JSON.stringify({ savedAt: Date.now(), data }),
    );
    const keys = Object.keys(sessionStorage).filter((key) =>
      key.startsWith(prefix + 'topic:'),
    );
    if (keys.length > 12) {
      keys.sort(
        (a, b) =>
          JSON.parse(sessionStorage.getItem(a)!).savedAt -
          JSON.parse(sessionStorage.getItem(b)!).savedAt,
      );
      for (const oldest of keys.slice(0, keys.length - 12))
        sessionStorage.removeItem(oldest);
    }
  } catch {
    /* Storage is optional; live reads still work. */
  }
}
export function cachedTopic(id: string): TopicData | null {
  const result = topicSchema.safeParse(read('topic:' + id));
  return result.success && result.data.id === id ? result.data : null;
}
export const rememberTopic = (topic: TopicData) =>
  save('topic:' + topic.id, topic);
export function forgetTopic(id: string) {
  try {
    sessionStorage.removeItem(prefix + 'topic:' + id);
  } catch {
    /* optional storage */
  }
  const home = cachedHome();
  if (home)
    rememberHome({
      latest: home.latest.filter((topic) => topic.id !== id),
      mostVisited: home.mostVisited.filter((topic) => topic.id !== id),
    });
}
export function cachedHome(): HomeData | null {
  const result = homeSchema.safeParse(read('home'));
  return result.success ? result.data : null;
}
export const rememberHome = (home: HomeData) => save('home', home);
const pending = new Map<string, Promise<TopicData>>();
let generation = 0;
export function forgetAllContent() {
  generation += 1;
  pending.clear();
  try {
    for (const key of Object.keys(sessionStorage))
      if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch {
    /* optional storage */
  }
}
export function loadTopic(id: string): Promise<TopicData> {
  const existing = pending.get(id);
  if (existing) return existing;
  const startedGeneration = generation;
  const request = readApi(
    `/api/topics/${encodeURIComponent(id)}`,
    topicSchema,
    AbortSignal.timeout(10000),
  )
    .then((topic) => {
      if (startedGeneration === generation) rememberTopic(topic);
      return topic;
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) forgetTopic(id);
      throw error;
    })
    .finally(() => {
      if (pending.get(id) === request) pending.delete(id);
    });
  pending.set(id, request);
  return request;
}
export function prefetchTopic(id: string) {
  if (!cachedTopic(id)) void loadTopic(id).catch(() => {});
}
