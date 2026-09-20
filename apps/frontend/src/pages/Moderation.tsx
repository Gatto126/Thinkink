import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useSession, loadSession } from '../auth/session';
import { ContentManager } from '../components/ContentManager';
import { ContentBudget } from '../components/ContentBudget';
import { UserManager } from '../components/UserManager';

export function Moderation() {
  const { user, loading, error } = useSession();
  const [mode, setMode] = useState<'topics' | 'comments' | 'users'>('topics');
  useEffect(() => {
    const previous = document.title;
    document.title = 'Moderation — Thinkink';
    window.scrollTo(0, 0);
    return () => {
      document.title = previous;
    };
  }, []);
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
        <button className="text-button" onClick={() => void loadSession()}>
          Try again
        </button>
      </main>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isModerator)
    return (
      <main id="main" className="auth-page">
        <h1>Moderator access required.</h1>
        <Link className="text-button" to="/account">
          Back to your account
        </Link>
      </main>
    );
  return (
    <main id="main" className="moderation-page">
      <Link to="/account" className="back-link">
        <ArrowLeft size={14} /> Back to your account
      </Link>
      <div className="auth-heading">
        <p className="eyebrow">
          <ShieldCheck size={16} /> CONTENT MODERATION
        </p>
        <h1>
          A space worth
          <br />
          <em>looking after.</em>
        </h1>
      </div>
      <div
        className="moderation-tabs"
        role="group"
        aria-label="Manage content and users"
      >
        <button
          aria-pressed={mode === 'topics'}
          onClick={() => setMode('topics')}
        >
          Topics
        </button>
        <button
          aria-pressed={mode === 'comments'}
          onClick={() => setMode('comments')}
        >
          Comments
        </button>
        <button
          aria-pressed={mode === 'users'}
          onClick={() => setMode('users')}
        >
          Users
        </button>
      </div>
      <ContentBudget />
      {mode === 'users' ? (
        <UserManager />
      ) : (
        <ContentManager key={mode} mode={mode} />
      )}
    </main>
  );
}
