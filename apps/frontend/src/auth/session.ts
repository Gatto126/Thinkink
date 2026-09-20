import { useSyncExternalStore } from 'react';
import { getSessionState, subscribeSession } from './session-store';

export { authRequest, loadSession } from './session-store';

export function useSession() {
  return useSyncExternalStore(subscribeSession, getSessionState);
}
