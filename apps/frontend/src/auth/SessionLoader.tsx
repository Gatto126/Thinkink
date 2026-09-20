import { useEffect } from 'react';
import { loadSession } from './session';

export function SessionLoader() {
  useEffect(() => {
    void loadSession();
    const refresh = () => {
      if (!document.hidden) void loadSession();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  return null;
}
