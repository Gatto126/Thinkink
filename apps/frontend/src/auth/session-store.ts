import { z } from 'zod';
import {
  apiErrorSchema,
  avatarSchema,
  sessionSchema,
} from '@thinkink/shared/contracts';
import type { SessionState } from '@thinkink/shared/contracts';

const previewKey = 'thinkink-account-preview-v1';
const previewSchema = z.discriminatedUnion('signedIn', [
  z
    .object({ signedIn: z.literal(true), avatar: avatarSchema.nullable() })
    .strict(),
  z.object({ signedIn: z.literal(false) }).strict(),
]);
type AccountPreview = z.infer<typeof previewSchema>;

// A tab-local visual hint, never authentication state. Do not store identity,
// email, credentials or tokens; protected pages still await the server session.
function readPreview(): AccountPreview | null {
  try {
    const parsed = previewSchema.safeParse(
      JSON.parse(sessionStorage.getItem(previewKey) ?? 'null'),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function rememberPreview(user: SessionState['user']): AccountPreview {
  const preview: AccountPreview = user
    ? { signedIn: true, avatar: user.profile.avatar }
    : { signedIn: false };
  try {
    sessionStorage.setItem(previewKey, JSON.stringify(preview));
  } catch {
    // The app remains usable when browser storage is disabled.
  }
  return preview;
}

type State = SessionState & {
  loading: boolean;
  error: string | null;
  accountPreview: AccountPreview | null;
};
let state: State = {
  user: null,
  available: false,
  localSignup: false,
  loading: true,
  error: null,
  accountPreview: readPreview(),
};
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
function publish(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSessionState() {
  return state;
}

export async function authRequest(
  path: string,
  method = 'GET',
  data?: unknown,
) {
  const response = await fetch(`/api/auth/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401)
      publish({
        ...state,
        user: null,
        loading: false,
        accountPreview: rememberPreview(null),
      });
    const error = apiErrorSchema.safeParse(value);
    throw new Error(
      error.success ? error.data.error.message : 'Please try again.',
    );
  }
  const result = sessionSchema.safeParse(value);
  if (!result.success)
    throw new Error('Account services are temporarily unavailable.');
  const session = result.data;
  publish({
    ...session,
    loading: false,
    error: null,
    accountPreview: rememberPreview(session.user),
  });
  return session;
}

export function loadSession(): Promise<void> {
  if (pending) return pending;
  pending = authRequest('session')
    .then(() => {})
    .catch(() => {
      publish({
        ...state,
        loading: false,
        error: 'Account services are temporarily unavailable.',
      });
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
