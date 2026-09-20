export interface RefreshState {
  lastSuccessAt: number | null;
  retryNotBefore: number | null;
  running: boolean;
}

// Explicit time makes boundary tests independent of browser clocks or real waits.
// This policy is not a lock: the future room must atomically claim each job.
export function shouldRefresh(
  state: RefreshState,
  now: number,
  hasReaders: boolean,
  intervalMs: number,
): boolean {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new RangeError(
      'Refresh timing must be finite with a positive interval.',
    );
  }
  if (!hasReaders || state.running) return false;
  if (state.retryNotBefore !== null && now < state.retryNotBefore) return false;
  return (
    state.lastSuccessAt === null || now >= state.lastSuccessAt + intervalMs
  );
}
