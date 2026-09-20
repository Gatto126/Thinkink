import { describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { loginSchema, signupSchema } from '@thinkink/shared/contracts';
import {
  configured,
  localSignupAllowed,
  sameOrigin,
} from '../../src/auth/config';
import {
  cookieNames,
  readCookies,
  sessionCookies,
} from '../../src/auth/cookies';
import { handleAuth } from '../../src/auth/routes';

const local = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test',
  SUPABASE_SECRET_KEY: 'test',
  SIGNUP_INVITE_CODE: 'local-code',
  AUTH_LOCAL_SIGNUP: 'true',
};
const req = (path: string, options?: RequestInit) =>
  new Request(`http://127.0.0.1:4173/api/auth/${path}`, options);
const post = {
  method: 'POST',
  headers: {
    Origin: 'http://127.0.0.1:4173',
    'Content-Type': 'application/json',
  },
};

describe('authentication boundaries', () => {
  it('requires six characters for signup while preserving shorter-password login', () => {
    for (const password of ['a', '12345', '123456', 'a'.repeat(129)]) {
      const credentials = { email: 'test@example.test', password };
      expect(loginSchema.safeParse(credentials).success).toBe(true);
      expect(
        signupSchema.safeParse({
          ...credentials,
          username: 'tester',
          invitation: 'local-code',
        }).success,
      ).toBe(password.length >= 6);
    }
    expect(
      loginSchema.safeParse({ email: 'test@example.test', password: '' })
        .success,
    ).toBe(false);
  });
  it('requires explicit local signup and two loopback hosts', () => {
    expect(localSignupAllowed(req('signup'), local)).toBe(true);
    expect(
      localSignupAllowed(req('signup'), {
        ...local,
        AUTH_LOCAL_SIGNUP: 'false',
      }),
    ).toBe(false);
    expect(
      localSignupAllowed(req('signup'), {
        ...local,
        SUPABASE_URL: 'https://example.supabase.co',
      }),
    ).toBe(false);
    expect(
      localSignupAllowed(
        new Request('https://thinkink.example/api/auth/signup'),
        local,
      ),
    ).toBe(false);
    expect(configured({})).toBe(false);
  });
  it('rejects foreign, missing and cross-site mutation origins', async () => {
    for (const origin of [undefined, 'https://other.example']) {
      const response = await handleAuth(
        req('logout', {
          method: 'POST',
          headers: origin ? { Origin: origin } : {},
        }),
        local,
      );
      expect(response.status).toBe(403);
    }
    expect(
      sameOrigin(
        req('logout', {
          ...post,
          headers: { ...post.headers, 'Sec-Fetch-Site': 'cross-site' },
        }),
        local,
      ),
    ).toBe(false);
    expect(sameOrigin(req('logout', post), local)).toBe(true);
  });
  it('exposes no credentials when configuration is missing', async () => {
    const response = await handleAuth(req('session'), {});
    expect(await response.json()).toEqual({
      user: null,
      available: false,
      localSignup: false,
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not turn GET requests into signout or profile changes', async () => {
    expect((await handleAuth(req('logout'), local)).status).toBe(405);
    expect((await handleAuth(req('profile'), local)).status).toBe(405);
  });
  it('rejects invalid invitations and oversized or non-JSON inputs before a provider request', async () => {
    expect(
      (
        await handleAuth(
          req('signup', {
            ...post,
            body: JSON.stringify({
              email: 'test@example.test',
              password: 'a-long-local-password',
              username: 'tester',
              invitation: 'wrong',
            }),
          }),
          local,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAuth(
          req('login', { ...post, body: 'x'.repeat(8193) }),
          local,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleAuth(
          req('login', {
            method: 'POST',
            headers: { Origin: post.headers.Origin },
            body: '{}',
          }),
          local,
        )
      ).status,
    ).toBe(415);
  });
  it('rejects a profile update without a session', async () => {
    const response = await handleAuth(
      req('profile', {
        ...post,
        method: 'PATCH',
        body: JSON.stringify({ avatarId: 'iris' }),
      }),
      local,
    );
    expect(response.status).toBe(401);
  });
  it('protects cookies on HTTPS and clears both tokens on logout', () => {
    const request = new Request('https://thinkink.example/api/auth/login');
    const headers = new Headers();
    sessionCookies(headers, request, {
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
    } as Session);
    const values = headers.getSetCookie();
    expect(values).toHaveLength(2);
    for (const cookie of values) {
      expect(cookie).toContain('__Host-thinkink-');
      expect(cookie).toContain('HttpOnly; SameSite=Lax; Secure');
      expect(cookie).not.toContain('Domain=');
    }
    const cleared = new Headers();
    sessionCookies(cleared, request, null);
    expect(
      cleared.getSetCookie().every((cookie) => cookie.includes('Max-Age=0')),
    ).toBe(true);
    expect(cookieNames(req('session')).access).toBe('thinkink-access');
    expect(
      readCookies(
        new Request(request, {
          headers: {
            Cookie:
              '__Host-thinkink-access=access; __Host-thinkink-refresh=refresh',
          },
        }),
      ),
    ).toEqual({ access: 'access', refresh: 'refresh' });
  });
});

describe('invited production beta', () => {
  it('enables the immediate invitation flow only on explicitly configured HTTPS origins', async () => {
    const { signupAllowed } = await import('../../src/auth/config');
    const request = new Request(
      'https://beta.thinkink.example/api/auth/signup',
    );
    const beta = {
      ...local,
      SUPABASE_URL: 'https://project.supabase.co',
      AUTH_LOCAL_SIGNUP: 'false',
      AUTH_BETA_SIGNUP: 'true',
      AUTH_ALLOWED_ORIGINS: 'https://beta.thinkink.example',
    };
    expect(signupAllowed(request, beta)).toBe(true);
    expect(signupAllowed(request, { ...beta, AUTH_BETA_SIGNUP: 'false' })).toBe(
      false,
    );
    expect(signupAllowed(request, { ...beta, AUTH_ALLOWED_ORIGINS: '' })).toBe(
      false,
    );
    expect(signupAllowed(request, { ...beta, SIGNUP_INVITE_CODE: '' })).toBe(
      false,
    );
    expect(
      signupAllowed(
        new Request('http://beta.thinkink.example/api/auth/signup'),
        beta,
      ),
    ).toBe(false);
    expect(signupAllowed(req('signup'), local)).toBe(true);
  });
});
