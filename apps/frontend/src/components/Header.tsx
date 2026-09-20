import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Moon, Sun, UserRound } from 'lucide-react';
import { AccountMenu } from './AccountMenu';
import { TopicSearch } from './TopicSearch';
import { useSession } from '../auth/session';
import { readTheme, subscribeTheme, toggleTheme } from '../theme';
import { attachHeaderMotion } from '../animations/header';
import { ReadingProgress } from './ReadingProgress';

function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  const Icon = next === 'light' ? Sun : Moon;
  return (
    <button
      className="icon-button theme-control"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={toggleTheme}
    >
      <Icon size={18} />
      <span className="theme-label">{next}</span>
    </button>
  );
}

export function Header({
  documentNavigation = false,
}: {
  documentNavigation?: boolean;
}) {
  const { accountPreview, loading, user } = useSession();
  const { pathname } = useLocation();
  const showSearch =
    !/^\/(login|signup)\/?$/i.test(pathname) &&
    !(pathname.replace(/\/$/, '') === '/account' && !user?.profile.avatar);
  const shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Match the destination scroll before calculating the compact header pose.
    if (pathname.startsWith('/topics/'))
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (shell.current) return attachHeaderMotion(shell.current, showSearch);
  }, [pathname, showSearch]);
  return (
    <div
      className={`header-shell${showSearch ? ' header-shell--search' : ''}`}
      ref={shell}
    >
      <header className="site-header">
        <div className="header-inner">
          <div className="header-brand">
            <Link
              to="/"
              reloadDocument={documentNavigation}
              className="wordmark"
              aria-label="Thinkink home"
            >
              thinkink<span className="brand-dot">.</span>
            </Link>
            <nav aria-label="Main navigation">
              {pathname !== '/' && (
                <Link
                  to="/"
                  reloadDocument={documentNavigation}
                  className="nav-link"
                >
                  Explore
                </Link>
              )}
              {pathname !== '/mission/' && pathname !== '/mission' && (
                <a href="/mission/" className="nav-link">
                  Mission
                </a>
              )}
            </nav>
          </div>
          <div className="header-actions">
            <div className="header-account" aria-busy={loading}>
              {accountPreview?.signedIn ? (
                <AccountMenu
                  key={pathname}
                  avatar={accountPreview.avatar}
                  isAdmin={user?.isModerator === true}
                  documentNavigation={documentNavigation}
                />
              ) : accountPreview || !loading ? (
                <Link
                  to="/login"
                  reloadDocument={documentNavigation}
                  className="sign-in-link"
                  aria-label="Sign in"
                  title="Sign in"
                >
                  <span className="sign-in-label">
                    Sign in <ArrowUpRight size={14} aria-hidden="true" />
                  </span>
                  <UserRound
                    className="sign-in-icon"
                    size={18}
                    aria-hidden="true"
                  />
                </Link>
              ) : null}
            </div>
            <ThemeControl />
          </div>
        </div>
        {showSearch && (
          <TopicSearch
            key={`search:${pathname}`}
            documentNavigation={documentNavigation}
          />
        )}
        {/^\/topics\/[^/]+\/?$/.test(pathname) && (
          <ReadingProgress key={`reading:${pathname}`} />
        )}
      </header>
    </div>
  );
}
