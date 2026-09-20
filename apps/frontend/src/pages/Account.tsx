import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import {
  avatarCatalogSchema,
  deleteAccountSchema,
} from '@thinkink/shared/contracts';
import type { AvatarOption } from '@thinkink/shared/contracts';
import { readApi } from '../api';
import { authRequest, loadSession, useSession } from '../auth/session';
import { Avatar } from '../components/Avatar';
import { ContentManager } from '../components/ContentManager';

export function Account() {
  const { user, loading, error } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  useEffect(() => {
    const previous = document.title;
    document.title = 'Your account — Thinkink';
    window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError('');
    void readApi('/api/avatars', avatarCatalogSchema, controller.signal)
      .then(({ avatars }) => {
        setAvatars(avatars);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setCatalogError('The avatar collection could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  const selectedId = selection ?? user?.profile.avatar?.id ?? '';
  const preview =
    avatars.find((avatar) => avatar.id === selectedId) ??
    user?.profile.avatar ??
    null;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await authRequest('profile', 'PATCH', { avatarId: selectedId });
      navigate('/', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setMessage('');
    try {
      await authRequest('logout', 'POST');
      navigate('/', { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input = deleteAccountSchema.safeParse({
      password: fields.get('password'),
      confirmation: fields.get('confirmation') === 'on',
    });
    if (!input.success) {
      setMessage('Re-enter your password and confirm account deletion.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await authRequest('account', 'DELETE', input.data);
      form.reset();
      navigate('/', { replace: true });
    } catch (error) {
      form.reset();
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main id="main" className="auth-page">
        <p role="status">Loading your account…</p>
      </main>
    );
  if (error)
    return (
      <main id="main" className="auth-page">
        <p role="alert">{error}</p>
        <button onClick={() => void loadSession()}>Try again</button>
      </main>
    );
  if (!user) return <Navigate to="/login" replace />;
  return (
    <main id="main" className="auth-page account-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={14} aria-hidden="true" /> Back to explore
      </Link>
      <div className="auth-heading">
        <p className="eyebrow">YOUR SPACE TO THINK</p>
        <h1>
          Your <em>perspective.</em>
        </h1>
      </div>
      <form className="auth-form avatar-form" onSubmit={save}>
        <div className="avatar-preview">
          <Avatar avatar={preview} />
          <span className="eyebrow">{preview?.label ?? 'MAKE IT YOURS'}</span>
        </div>
        <fieldset className="avatar-picker" disabled={busy || catalogLoading}>
          <legend>Choose your avatar</legend>
          {catalogLoading && (
            <p className="field-hint" role="status">
              Loading avatars…
            </p>
          )}
          <div className="avatar-grid">
            {avatars.map((avatar) => (
              <label className="avatar-option" key={avatar.id}>
                <input
                  type="radio"
                  name="avatarId"
                  value={avatar.id}
                  checked={selectedId === avatar.id}
                  onChange={() => setSelection(avatar.id)}
                />
                <span className="avatar-choice">
                  <Avatar avatar={avatar} decorative />
                  <span className="avatar-check">
                    <Check size={12} aria-hidden="true" />
                  </span>
                </span>
                <span>{avatar.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {catalogError && (
          <div>
            <p className="field-hint" role="alert">
              {catalogError}
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        )}
        {!catalogLoading && !catalogError && avatars.length === 0 && (
          <p role="status" className="field-hint">
            New avatars will be available soon.
          </p>
        )}
        <button
          className="auth-submit"
          disabled={busy || !avatars.some((avatar) => avatar.id === selectedId)}
        >
          {busy ? 'Please wait…' : 'Save'}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </form>
      {message && (
        <p className="account-message" role="alert">
          {message}
        </p>
      )}
      <section className="account-details" aria-label="Account details">
        <dl>
          <div>
            <dt>Username</dt>
            <dd>{user.profile.username}</dd>
          </div>
          <div>
            <dt>Email address</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
        <p className="field-hint">
          Your username and email address cannot be changed. Your email stays
          private.
        </p>
        <button
          className="sign-out-button"
          type="button"
          onClick={() => void logout()}
          disabled={busy}
        >
          Sign out
        </button>
      </section>
      {user.isModerator && (
        <Link className="moderation-entry" to="/moderation">
          Moderation dashboard <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
      <ContentManager key={user.id} mode="own" />
      <details className="account-delete">
        <summary>Delete account</summary>
        <form onSubmit={deleteAccount}>
          <p>
            Your account and personal profile data will be permanently deleted.
            Shared topics and comments will remain, without a link to your
            profile.
          </p>
          <div className="auth-field">
            <label htmlFor="delete-password">Re-enter your password</label>
            <input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </div>
          <label className="delete-confirm">
            <input type="checkbox" name="confirmation" required />
            <span>I understand that this cannot be undone.</span>
          </label>
          <button className="delete-account-button" disabled={busy}>
            {busy ? 'Please wait…' : 'Permanently delete account'}
          </button>
        </form>
      </details>
    </main>
  );
}
