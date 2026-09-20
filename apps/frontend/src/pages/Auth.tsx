import { useId, useLayoutEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { loginSchema, signupSchema } from '@thinkink/shared/contracts';
import { authRequest, useSession } from '../auth/session';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Info } from 'lucide-react';

type AuthMode = 'login' | 'signup';

export function Auth({ mode }: { mode: AuthMode }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signup = mode === 'signup';
  const [showPassword, setShowPassword] = useState(false);
  const [invitation, setInvitation] = useState('');
  const noticeId = useId();
  const passwordHintId = useId();

  useLayoutEffect(() => {
    const previousTitle = document.title;
    document.title = signup
      ? 'Create account — Thinkink'
      : 'Sign in — Thinkink';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return () => {
      document.title = previousTitle;
    };
  }, [signup]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = (signup ? signupSchema : loginSchema).safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!input.success) {
      setError(
        input.error.issues[0]?.message ?? 'Check the form and try again.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await authRequest(signup ? 'signup' : 'login', 'POST', input.data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  const enabled = session.available && (!signup || session.localSignup);
  if (session.user)
    return (
      <Navigate
        to={
          session.user.isModerator
            ? '/moderation'
            : session.user.profile.avatar
              ? '/'
              : '/account'
        }
        replace
      />
    );
  return (
    <main id="main" className="auth-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" /> Back to explore
      </Link>
      <div className="auth-heading">
        <p className="eyebrow">A SPACE FOR CURIOUS MINDS</p>
        <h1>
          {signup ? (
            <>
              Bring your
              <br />
              <em>perspective.</em>
            </>
          ) : (
            <>
              Welcome
              <br />
              <em>back.</em>
            </>
          )}
        </h1>
        <p>
          {signup
            ? 'A little curiosity. A different point of view. You belong in the conversation.'
            : 'There’s always another perspective. Pick up the conversation.'}
        </p>
      </div>
      <form
        className="auth-form"
        onSubmit={(event) => void submit(event)}
        aria-describedby={!enabled ? noticeId : undefined}
      >
        {signup && (
          <div className="auth-field">
            <label htmlFor="auth-username">Username</label>
            <input
              id="auth-username"
              name="username"
              autoComplete="username"
              placeholder="Your public name"
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]{3,30}"
            />
          </div>
        )}
        <div className="auth-field">
          <label htmlFor="auth-email">Email address</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete={signup ? 'email' : 'username'}
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">Password</label>
          <div className="password-field">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={signup ? 'new-password' : 'current-password'}
              placeholder={signup ? 'Create a password' : 'Your password'}
              minLength={signup ? 6 : undefined}
              aria-describedby={signup ? passwordHintId : undefined}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="auth-password"
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
          {signup && (
            <p className="field-hint" id={passwordHintId}>
              At least 6 characters.
            </p>
          )}
        </div>
        {signup && (
          <div className="auth-field">
            <label htmlFor="auth-invite">Invitation code</label>
            <input
              id="auth-invite"
              name="invitation"
              autoComplete="off"
              placeholder="Your invitation code"
              value={invitation}
              onChange={(event) => setInvitation(event.target.value)}
              onClick={(event) => {
                if (event.detail === 3) setInvitation('Thinkink-beta');
              }}
              required
            />
            <p className="field-hint">
              An invitation is needed to create an account.
            </p>
          </div>
        )}
        {!enabled && (
          <div className="auth-notice" id={noticeId} role="status">
            <Info size={17} aria-hidden="true" />
            <p>
              {session.loading
                ? 'Checking account services…'
                : (session.error ??
                  (signup
                    ? 'Account creation is not available here yet.'
                    : 'Sign-in is temporarily unavailable. Please try again later.'))}
            </p>
          </div>
        )}
        {error && (
          <p className="field-hint" role="alert">
            {error}
          </p>
        )}
        <button
          className="auth-submit"
          type="submit"
          disabled={!enabled || busy}
          aria-describedby={!enabled ? noticeId : undefined}
        >
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
      <p className="auth-switch">
        {signup ? (
          <>
            Already have an account?{' '}
            <Link to="/login">
              Sign in <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            Have an invitation?{' '}
            <Link to="/signup">
              Create an account <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
