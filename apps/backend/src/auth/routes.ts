import type { User } from '@supabase/supabase-js';
import {
  loginSchema,
  signupSchema,
  profileUpdateSchema,
  deleteAccountSchema,
  accountSchema,
} from '@thinkink/shared/contracts';
import type { Account } from '@thinkink/shared/contracts';
import { configured, isLoopback, signupAllowed, sameOrigin } from './config';
import type { AuthEnv } from './config';
import { sessionCookies } from './cookies';
import {
  AuthFailure,
  body,
  providerFailure,
  authenticate,
  assertAccountEnvironment,
} from './request';
import { supabase } from './supabase';

async function account(
  env: AuthEnv,
  user: User,
  token: string,
): Promise<Account> {
  // The user's JWT, never the administrative key, controls profile access through RLS.
  const { data, error } = await supabase(env, { token })
    .from('profiles')
    .select('username,created_at,avatar:avatar_options(id,label,src)')
    .eq('id', user.id)
    .single();
  if (error || !data || !user.email) providerFailure();
  const role = await supabase(env, { token }).rpc('is_moderator');
  if (role.error) providerFailure();
  return accountSchema.parse({
    id: user.id,
    isModerator: role.data === true,
    email: user.email!,
    profile: {
      username: data.username,
      avatar: data.avatar,
      createdAt: data.created_at,
    },
  });
}

export async function handleAuth(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  });
  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  const path = new URL(request.url).pathname;
  const methods: Record<string, string> = {
    '/api/auth/session': 'GET',
    '/api/auth/login': 'POST',
    '/api/auth/signup': 'POST',
    '/api/auth/logout': 'POST',
    '/api/auth/profile': 'PATCH',
    '/api/auth/account': 'DELETE',
  };
  try {
    if (!methods[path])
      throw new AuthFailure(404, 'NOT_FOUND', 'This endpoint does not exist.');
    if (request.method !== methods[path]) {
      headers.set('Allow', methods[path]);
      throw new AuthFailure(
        405,
        'METHOD_NOT_ALLOWED',
        'This method is not allowed.',
      );
    }
    if (request.method !== 'GET' && !sameOrigin(request, env))
      throw new AuthFailure(
        403,
        'ORIGIN_REJECTED',
        'Reload Thinkink and try again.',
      );
    if (new URL(request.url).protocol !== 'https:' && !isLoopback(request.url))
      throw new AuthFailure(
        400,
        'HTTPS_REQUIRED',
        'A secure connection is required.',
      );
    const localSignup = signupAllowed(request, env);
    if (!configured(env)) {
      if (path === '/api/auth/session')
        return reply({ user: null, available: false, localSignup: false });
      providerFailure();
    }
    if (path === '/api/auth/login' || path === '/api/auth/signup') {
      const signup = path.endsWith('/signup');
      const input = (signup ? signupSchema : loginSchema).safeParse(
        await body(request),
      );
      if (!input.success)
        throw new AuthFailure(
          400,
          'INVALID_INPUT',
          input.error.issues[0]?.message ?? 'Check the form and try again.',
        );
      if (signup) {
        if (!localSignup)
          throw new AuthFailure(
            503,
            'SIGNUP_UNAVAILABLE',
            'Account creation is not available here yet.',
          );
        const fields = signupSchema.parse(input.data);
        if (fields.invitation !== env.SIGNUP_INVITE_CODE)
          throw new AuthFailure(
            403,
            'INVITE_INVALID',
            'This invitation code is not valid.',
          );
        const { error } = await supabase(env, {
          admin: true,
        }).auth.admin.createUser({
          email: fields.email,
          password: fields.password,
          email_confirm: true,
          user_metadata: { username: fields.username },
        });
        if (error) {
          if (error.status === 429) providerFailure(429);
          throw new AuthFailure(
            409,
            'SIGNUP_FAILED',
            'Unable to create this account. Try another email or username, or sign in.',
          );
        }
      }
      const { data, error } = await supabase(env).auth.signInWithPassword(
        input.data,
      );
      if (error || !data.session || !data.user) {
        if (
          error &&
          (!error.status || error.status >= 500 || error.status === 429)
        )
          providerFailure(error.status);
        throw new AuthFailure(
          401,
          'LOGIN_FAILED',
          signup
            ? 'Account created. Please sign in to continue.'
            : 'Email or password is incorrect.',
        );
      }
      assertAccountEnvironment(data.user, request, env);
      const result = await account(env, data.user, data.session.access_token);
      sessionCookies(headers, request, data.session);
      return reply(
        { user: result, available: true, localSignup },
        signup ? 201 : 200,
      );
    }
    const identity = await authenticate(request, env, headers);
    if (path === '/api/auth/logout') {
      if (identity) {
        const { error } = await supabase(env).auth.admin.signOut(
          identity.token,
          'local',
        );
        if (
          error &&
          error.status !== 401 &&
          error.status !== 403 &&
          error.status !== 404
        )
          providerFailure(error.status);
      }
      sessionCookies(headers, request, null);
      return reply({ user: null, available: true, localSignup });
    }
    if (path === '/api/auth/session')
      return reply({
        user: identity
          ? await account(env, identity.user, identity.token)
          : null,
        available: true,
        localSignup,
      });
    if (!identity)
      throw new AuthFailure(
        401,
        'SIGN_IN_REQUIRED',
        'Sign in to manage your profile.',
      );
    if (path === '/api/auth/account') {
      const input = deleteAccountSchema.safeParse(await body(request));
      if (!input.success)
        throw new AuthFailure(
          400,
          'CONFIRMATION_REQUIRED',
          'Re-enter your password and confirm account deletion.',
        );
      if (!env.SUPABASE_SECRET_KEY) providerFailure();
      const { data: verified, error } = await supabase(
        env,
      ).auth.signInWithPassword({
        email: identity.user.email!,
        password: input.data.password,
      });
      if (
        error &&
        (!error.status || error.status >= 500 || error.status === 429)
      )
        providerFailure(error.status);
      if (error || !verified.session || verified.user?.id !== identity.user.id)
        throw new AuthFailure(
          403,
          'PASSWORD_INCORRECT',
          'Your password is incorrect. Your account has not been deleted.',
        );
      const result = await supabase(env, { admin: true }).auth.admin.deleteUser(
        identity.user.id,
        false,
      );
      if (result.error) {
        // Reauthentication creates a temporary session; do not leave it behind on failure.
        await supabase(env).auth.admin.signOut(
          verified.session.access_token,
          'local',
        );
        providerFailure(result.error.status);
      }
      sessionCookies(headers, request, null);
      return reply({ user: null, available: true, localSignup });
    }
    const input = profileUpdateSchema.safeParse(await body(request));
    if (!input.success)
      throw new AuthFailure(
        400,
        'INVALID_INPUT',
        input.error.issues[0]?.message ?? 'Check the form and try again.',
      );
    const client = supabase(env, { token: identity.token });
    const { data: option, error: catalogError } = await client
      .from('avatar_options')
      .select('id')
      .eq('id', input.data.avatarId)
      .eq('available', true)
      .maybeSingle();
    if (catalogError) providerFailure();
    if (!option)
      throw new AuthFailure(
        400,
        'AVATAR_UNAVAILABLE',
        'Choose an avatar from the available collection.',
      );
    const { error } = await client
      .from('profiles')
      .update({ avatar_id: input.data.avatarId })
      .eq('id', identity.user.id);
    if (error) providerFailure();
    return reply({
      user: await account(env, identity.user, identity.token),
      available: true,
      localSignup,
    });
  } catch (error) {
    if (error instanceof AuthFailure)
      return reply(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return reply(
      {
        error: {
          code: 'AUTH_UNAVAILABLE',
          message:
            'Account services are temporarily unavailable. Please try again.',
        },
      },
      503,
    );
  }
}
