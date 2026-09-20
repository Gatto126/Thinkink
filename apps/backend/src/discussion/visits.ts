import { z } from 'zod';
import { isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { authenticate } from '../auth/request';
import { supabase } from '../auth/supabase';

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
async function key(env: AuthEnv) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error('Unavailable');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SUPABASE_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
function cookieName(request: Request) {
  return `${new URL(request.url).protocol === 'https:' ? '__Host-' : ''}thinkink-reader`;
}
async function readerId(
  request: Request,
  env: AuthEnv,
): Promise<string | null> {
  const name = cookieName(request);
  const value = request.headers
    .get('Cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1);
  if (!value) return null;
  const [id, signature] = value.split('.');
  if (
    !id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null;
  const bytes = new Uint8Array(
    signature.match(/../g)!.map((v) => parseInt(v, 16)),
  );
  return (await crypto.subtle.verify(
    'HMAC',
    await key(env),
    bytes,
    new TextEncoder().encode('reader:' + id),
  ))
    ? id
    : null;
}
export async function ensureReaderCookie(
  request: Request,
  env: AuthEnv,
  headers: Headers,
) {
  if (!env.SUPABASE_SECRET_KEY || (await readerId(request, env))) return;
  const secure = new URL(request.url).protocol === 'https:';
  if (!secure && !isLoopback(request.url)) return;
  const id = crypto.randomUUID();
  const signature = hex(
    await crypto.subtle.sign(
      'HMAC',
      await key(env),
      new TextEncoder().encode('reader:' + id),
    ),
  );
  headers.append(
    'Set-Cookie',
    `${cookieName(request)}=${id}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`,
  );
}
export async function handleVisit(request: Request, env: AuthEnv) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  });
  const reply = (status: number) => new Response(null, { status, headers });
  if (request.method !== 'POST') return reply(405);
  if (!sameOrigin(request, env)) return reply(403);
  if (new URL(request.url).protocol !== 'https:' && !isLoopback(request.url))
    return reply(400);
  const id = z.uuid().safeParse(new URL(request.url).pathname.split('/')[3]);
  if (!id.success) return reply(404);
  if (!env.SUPABASE_SECRET_KEY) return reply(503);
  try {
    const reader = await readerId(request, env);
    if (!reader) {
      await ensureReaderCookie(request, env, headers);
      return reply(202);
    }
    const identity = await authenticate(request, env, headers);
    const visitor = hex(
      await crypto.subtle.sign(
        'HMAC',
        await key(env),
        new TextEncoder().encode(
          identity ? 'account:' + identity.user.id : 'browser:' + reader,
        ),
      ),
    );
    const { error } = await supabase(env, { admin: true }).rpc(
      'record_topic_visit',
      { topic_input: id.data, visitor_input: visitor },
    );
    return reply(error ? 503 : 204);
  } catch {
    return reply(503);
  }
}
