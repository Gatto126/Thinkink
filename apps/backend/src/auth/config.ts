export interface AuthEnv {
  TOPIC_ROOMS?: DurableObjectNamespace;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SIGNUP_INVITE_CODE?: string;
  AUTH_LOCAL_SIGNUP?: string;
  AUTH_BETA_SIGNUP?: string;
  AUTH_ALLOWED_ORIGINS?: string;
  SERPER_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  CONTENT_PROVIDERS_ENABLED?: string;
  AUTOMATED_TEST_MODE?: string;
}

export function isLoopback(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function configured(env: AuthEnv): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

// Automatic email confirmation is exclusively for the local test environment.
export function localSignupAllowed(request: Request, env: AuthEnv): boolean {
  return (
    env.AUTH_LOCAL_SIGNUP === 'true' &&
    isLoopback(request.url) &&
    isLoopback(env.SUPABASE_URL ?? '') &&
    Boolean(env.SUPABASE_SECRET_KEY && env.SIGNUP_INVITE_CODE)
  );
}

export function sameOrigin(request: Request, env: AuthEnv): boolean {
  const origin = request.headers.get('Origin');
  const allowed = env.AUTH_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? [
    new URL(request.url).origin,
  ];
  return (
    Boolean(origin && allowed.includes(origin)) &&
    request.headers.get('Sec-Fetch-Site') !== 'cross-site'
  );
}

// The invited beta deliberately uses the same immediate email/password flow as local development.
export function signupAllowed(request: Request, env: AuthEnv): boolean {
  if (localSignupAllowed(request, env)) return true;
  return (
    env.AUTH_BETA_SIGNUP === 'true' &&
    new URL(request.url).protocol === 'https:' &&
    !isLoopback(request.url) &&
    Boolean(
      env.SUPABASE_URL?.startsWith('https://') &&
      env.SUPABASE_SECRET_KEY &&
      env.SIGNUP_INVITE_CODE &&
      env.AUTH_ALLOWED_ORIGINS?.split(',')
        .map((value) => value.trim())
        .includes(new URL(request.url).origin),
    )
  );
}
