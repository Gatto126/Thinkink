import type { Session } from '@supabase/supabase-js';
import { isLoopback } from './config';

export function cookieNames(request: Request) {
  const prefix = new URL(request.url).protocol === 'https:' ? '__Host-' : '';
  return {
    access: `${prefix}thinkink-access`,
    refresh: `${prefix}thinkink-refresh`,
  };
}

export function readCookies(request: Request) {
  const cookies = new Map(
    (request.headers.get('Cookie') ?? '').split(';').map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator).trim(), entry.slice(separator + 1)];
    }),
  );
  const names = cookieNames(request);
  return {
    access: cookies.get(names.access),
    refresh: cookies.get(names.refresh),
  };
}

export function sessionCookies(
  headers: Headers,
  request: Request,
  session: Session | null,
) {
  const secure = new URL(request.url).protocol === 'https:';
  if (!secure && !isLoopback(request.url)) throw new Error('HTTPS required');
  const suffix = `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  const names = cookieNames(request);
  for (const [name, value, age] of [
    [
      names.access,
      session?.access_token ?? '',
      session ? session.expires_in : 0,
    ],
    [names.refresh, session?.refresh_token ?? '', session ? 604800 : 0],
  ] as const) {
    headers.append('Set-Cookie', `${name}=${value}; Max-Age=${age}${suffix}`);
  }
}
