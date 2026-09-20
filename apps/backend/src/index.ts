import { handleSocial } from './social/routes';
import { handleTopicSocket } from './discussion/realtime';
export { TopicRoom } from './discussion/room';
import { handleNotifications } from './notifications/routes';
import { handleComments } from './discussion/routes';
import { handleVisit } from './discussion/visits';
import { handleTopics } from './topics/routes';
import { handleModeration } from './moderation/routes';
import { providersEnabled } from './content/service';
function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function handleRequest(
  request: Request,
  env: AuthEnv = {},
): Response | Promise<Response> {
  const { pathname } = new URL(request.url);
  const socket = /^\/api\/topics\/([^/]+)\/live$/.exec(pathname);
  if (socket) return handleTopicSocket(request, env, socket[1]!);
  if (
    pathname === '/api/favorites' ||
    /^\/api\/topics\/[^/]+\/social$/.test(pathname) ||
    /^\/api\/comments\/[^/]+\/like$/.test(pathname)
  )
    return handleSocial(request, env);
  if (
    pathname === '/api/notifications' ||
    pathname === '/api/notifications/read'
  )
    return handleNotifications(request, env);
  if (
    /^\/api\/topics\/[^/]+\/comments$/.test(pathname) ||
    /^\/api\/comments\/[^/]+$/.test(pathname)
  )
    return handleComments(request, env);
  if (/^\/api\/topics\/[^/]+\/views$/.test(pathname))
    return handleVisit(request, env);
  if (
    pathname === '/api/account/topics' ||
    pathname.startsWith('/api/moderation/') ||
    /^\/api\/topics\/[^/]+\/(?:permissions|overview)$/.test(pathname) ||
    (request.method === 'DELETE' && /^\/api\/topics\/[^/]+$/.test(pathname))
  )
    return handleModeration(request, env);
  if (pathname === '/api/avatars') return handleAvatarCatalog(request, env);
  if (pathname.startsWith('/api/auth/')) return handleAuth(request, env);
  if (pathname === '/api/health' && request.method === 'GET') {
    return json({
      status: 'ok',
      milestone: 'content',
      contentProvidersEnabled: providersEnabled(env),
    });
  }
  if (
    pathname === '/api/home' ||
    pathname === '/api/topics' ||
    pathname.startsWith('/api/topics/')
  )
    return handleTopics(request, env);
  return json(
    { error: { code: 'NOT_FOUND', message: 'This endpoint does not exist.' } },
    404,
  );
}

export default { fetch: handleRequest } satisfies ExportedHandler<Env>;
import { handleAvatarCatalog } from './auth/avatars';
import { handleAuth } from './auth/routes';
import type { AuthEnv } from './auth/config';
