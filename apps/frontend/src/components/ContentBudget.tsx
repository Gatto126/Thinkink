import { useEffect, useRef, useState } from 'react';
import { providerBudgetSchema } from '@thinkink/shared/contracts';
import { readApi } from '../api';

type Budget = typeof providerBudgetSchema._output;
export function ContentBudget() {
  const [data, setData] = useState<Budget | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void readApi(
      '/api/moderation/budget',
      providerBudgetSchema,
      controller.signal,
    )
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Please try again.',
          );
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => () => mutation.current?.abort(), []);
  async function toggle() {
    mutation.current = new AbortController();
    setBusy(true);
    setError('');
    try {
      setData(
        await readApi(
          '/api/moderation/budget',
          providerBudgetSchema,
          mutation.current.signal,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paused: !data?.providers.every((provider) => provider.paused),
            }),
          },
        ),
      );
    } catch (error) {
      if (!mutation.current.signal.aborted)
        setError(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="content-budget">
      <summary>Content usage & limits</summary>
      <p className="field-hint">
        Requests from this installation. Reading saved topics uses no provider
        calls. Automatic refresh is off.
      </p>
      {data && (
        <>
          <div className="budget-rows">
            {data.providers.map((provider) => (
              <div key={provider.provider}>
                <strong>
                  {provider.provider === 'serper'
                    ? 'News searches'
                    : 'Free AI attempts'}
                </strong>
                <span>
                  {provider.dailyUsed} / {provider.dailyLimit} today ·{' '}
                  {provider.totalUsed} / {provider.totalLimit} total
                </span>
                {provider.cooldownUntil &&
                  Date.parse(provider.cooldownUntil) > Date.now() && (
                    <span>
                      Available after{' '}
                      {new Date(provider.cooldownUntil).toLocaleString()}
                    </span>
                  )}
              </div>
            ))}
          </div>
          <p className="field-hint">
            Daily counters reset at midnight UTC. Failed attempts count too.
            These are app limits, not the provider’s remaining balance.
          </p>
          {!data.enabled && (
            <p className="field-hint">
              Content preparation is disabled in this environment.
            </p>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void toggle()}
          >
            {busy
              ? 'Saving…'
              : data.providers.every((provider) => provider.paused)
                ? 'Resume new content'
                : 'Pause new content'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="text-button budget-refresh"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Refresh usage
      </button>
    </details>
  );
}
