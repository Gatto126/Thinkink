import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Settings, Shield, Bell, CheckCheck, Star } from 'lucide-react';
import type { AvatarOption } from '@thinkink/shared/contracts';
import { authRequest, useSession } from '../auth/session';
import { Avatar } from './Avatar';
import { useNotifications, notificationTime } from './Notifications';

export function AccountMenu({
  avatar,
  documentNavigation,
  isAdmin,
}: {
  avatar: AvatarOption | null;
  documentNavigation: boolean;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { user } = useSession();
  const inbox = useNotifications(user?.id, open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await authRequest('logout', 'POST');
      if (documentNavigation) window.location.assign('/');
      else navigate('/', { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.');
      setBusy(false);
    }
  }

  return (
    <div
      className="account-menu"
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        className="avatar-link"
        ref={trigger}
        aria-label="Account menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={
          inbox.data.unreadCount > 0 ? `${panelId}-count` : undefined
        }
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar avatar={avatar} decorative />
        {inbox.data.unreadCount > 0 && (
          <span
            id={`${panelId}-count`}
            className="notification-badge"
            aria-label={`${inbox.data.unreadCount} unread notifications`}
          >
            {inbox.data.unreadCount > 99 ? '99+' : inbox.data.unreadCount}
          </span>
        )}
      </button>
      <div
        id={panelId}
        className={`account-menu-panel${open ? ' is-open' : ''}`}
        inert={!open}
        aria-hidden={!open}
      >
        <div className="notification-toolbar">
          <h2>Notifications</h2>
          <div className="account-menu-actions">
            <Link
              to="/favorites"
              reloadDocument={documentNavigation}
              onClick={() => setOpen(false)}
              aria-label="Favorites"
              title="Favorites"
            >
              <Star size={18} aria-hidden="true" />
            </Link>
            <Link
              to="/account"
              reloadDocument={documentNavigation}
              onClick={() => setOpen(false)}
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={18} aria-hidden="true" />
            </Link>
            {isAdmin && (
              <Link
                to="/moderation"
                reloadDocument={documentNavigation}
                onClick={() => setOpen(false)}
                aria-label="Admin console"
                title="Admin console"
              >
                <Shield size={18} aria-hidden="true" />
              </Link>
            )}
            <button
              type="button"
              aria-disabled={busy}
              onClick={() => void logout()}
              aria-label={busy ? 'Logging out…' : 'Log out'}
              title="Log out"
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="notification-inbox" aria-label="Notifications">
          {inbox.data.unreadCount > 0 && (
            <div className="notification-status">
              <span>{inbox.data.unreadCount} unread</span>
              <button
                className="text-action"
                disabled={inbox.reading}
                onClick={() => void inbox.markRead(null)}
              >
                <CheckCheck size={15} aria-hidden="true" /> Mark all as read
              </button>
            </div>
          )}
          {inbox.error && (
            <div className="notification-empty">
              <p role="alert">{inbox.error}</p>
              <button className="text-action" onClick={inbox.reload}>
                Retry notifications
              </button>
            </div>
          )}
          {!inbox.data.items.length && !inbox.error && (
            <div className="notification-empty">
              <Bell size={24} aria-hidden="true" />
              <p>
                {inbox.loading
                  ? 'Loading notifications…'
                  : 'You’re all caught up'}
              </p>
              {!inbox.loading && (
                <span>
                  Replies and new comments on your topics will appear here.
                </span>
              )}
            </div>
          )}
          <ol className="notification-list">
            {inbox.data.items.map((item) => {
              const destination = `/topics/${item.topicId}#comment-${item.commentId}`;
              return (
                <li key={item.id}>
                  <Link
                    to={destination}
                    reloadDocument={documentNavigation}
                    className={`notification-item${item.read ? '' : ' is-unread'}`}
                    onClick={(event) => {
                      if (
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey ||
                        event.button !== 0
                      )
                        return;
                      event.preventDefault();
                      void (async () => {
                        if (!item.read && !(await inbox.markRead(item.id)))
                          return;
                        setOpen(false);
                        if (documentNavigation)
                          window.location.assign(destination);
                        else navigate(destination);
                      })();
                    }}
                  >
                    <span className="notification-avatar" aria-hidden="true">
                      {item.avatar ? (
                        <img src={item.avatar} alt="" />
                      ) : (
                        (item.username ?? '?').slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <span className="notification-content">
                      <span>
                        <strong>@{item.username ?? 'Deleted account'}</strong>{' '}
                        {item.kind === 'comment_like'
                          ? 'liked your comment'
                          : item.kind === 'reply'
                            ? 'replied to your comment'
                            : 'commented on your topic'}
                      </span>
                      <span className="notification-topic">
                        {item.topicTitle}
                      </span>
                      <span className="notification-preview">
                        {item.preview}
                      </span>
                      <time
                        dateTime={item.createdAt}
                        title={new Date(item.createdAt).toLocaleString('en')}
                      >
                        {notificationTime(item.createdAt)}
                      </time>
                    </span>
                    {!item.read && (
                      <span className="notification-dot" aria-label="Unread" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
          {(inbox.offset > 0 || inbox.data.hasMore) && (
            <nav
              className="notification-pagination"
              aria-label="Notification pages"
            >
              <button
                className="text-action"
                disabled={inbox.offset === 0 || inbox.loading}
                onClick={() =>
                  inbox.setOffset((value) => Math.max(0, value - 20))
                }
              >
                Newer
              </button>
              <button
                className="text-action"
                disabled={!inbox.data.hasMore || inbox.loading}
                onClick={() => inbox.setOffset((value) => value + 20)}
              >
                Older
              </button>
            </nav>
          )}
        </div>
        {error && (
          <p className="account-menu-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
