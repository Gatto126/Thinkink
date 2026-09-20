import { localSignupAllowed } from './config';
import type { AuthEnv } from './config';
import type { User } from '@supabase/supabase-js';
import { readCookies, sessionCookies } from './cookies';
import { supabase } from './supabase';

export class AuthFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function assertAccountEnvironment(
  user: User,
  request: Request,
  env: AuthEnv,
) {
  if (
    user.app_metadata.localDevelopmentOnly === true &&
    !localSignupAllowed(request, env)
  )
    throw new AuthFailure(
      403,
      'LOCAL_ACCOUNT_ONLY',
      'This development account is available only locally.',
    );
}

export async function body(
  request: Request,
  maxBytes = 8192,
): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json')
    throw new AuthFailure(415, 'JSON_REQUIRED', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader)
    throw new AuthFailure(
      400,
      'INVALID_INPUT',
      'Check the form and try again.',
    );
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AuthFailure(
        413,
        'BODY_TOO_LARGE',
        'This request is too large.',
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new AuthFailure(
      400,
      'INVALID_INPUT',
      'Check the form and try again.',
    );
  }
}

export function providerFailure(status?: number): never {
  if (status === 429)
    throw new AuthFailure(
      429,
      'RATE_LIMITED',
      'Too many attempts. Please try again later.',
    );
  throw new AuthFailure(
    503,
    'AUTH_UNAVAILABLE',
    'Account services are temporarily unavailable. Please try again.',
  );
}

export async function authenticate(
  request: Request,
  env: AuthEnv,
  headers: Headers,
) {
  const cookies = readCookies(request);
  const client = supabase(env);
  if (cookies.access) {
    const { data, error } = await client.auth.getUser(cookies.access);
    if (!error && data.user) {
      assertAccountEnvironment(data.user, request, env);
      return { user: data.user, token: cookies.access };
    }
    if (error && (!error.status || error.status >= 500 || error.status === 429))
      providerFailure(error.status);
  }
  if (cookies.refresh) {
    const { data, error } = await client.auth.refreshSession({
      refresh_token: cookies.refresh,
    });
    if (error && (!error.status || error.status >= 500 || error.status === 429))
      providerFailure(error.status);
    if (data.session && data.user) {
      assertAccountEnvironment(data.user, request, env);
      sessionCookies(headers, request, data.session);
      return { user: data.user, token: data.session.access_token };
    }
  }
  if (cookies.access || cookies.refresh) sessionCookies(headers, request, null);
  return null;
}
