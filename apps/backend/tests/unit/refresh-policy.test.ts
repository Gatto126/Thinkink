import { PRODUCTION_INTERVALS } from '@thinkink/shared/timing';
import { describe, expect, it } from 'vitest';
import { shouldRefresh } from '../../src/domain/refresh-policy';

const start = Date.UTC(2026, 8, 20, 10);
const saved = { lastSuccessAt: start, retryNotBefore: null, running: false };

describe('independent refresh clocks', () => {
  it('keeps the overview unchanged while news becomes due', () => {
    expect(
      shouldRefresh(
        saved,
        start + PRODUCTION_INTERVALS.newsMs,
        true,
        PRODUCTION_INTERVALS.newsMs,
      ),
    ).toBe(true);
    expect(
      shouldRefresh(
        saved,
        start + PRODUCTION_INTERVALS.newsMs,
        true,
        PRODUCTION_INTERVALS.summaryMs,
      ),
    ).toBe(false);
  });

  it('enforces the six-hour boundary without waiting', () => {
    const deadline = start + PRODUCTION_INTERVALS.summaryMs;
    expect(
      shouldRefresh(saved, deadline - 1, true, PRODUCTION_INTERVALS.summaryMs),
    ).toBe(false);
    expect(
      shouldRefresh(saved, deadline, true, PRODUCTION_INTERVALS.summaryMs),
    ).toBe(true);
  });

  it('only starts work when readers exist, including first generation', () => {
    const empty = { ...saved, lastSuccessAt: null };
    expect(
      shouldRefresh(empty, start, false, PRODUCTION_INTERVALS.summaryMs),
    ).toBe(false);
    expect(
      shouldRefresh(empty, start, true, PRODUCTION_INTERVALS.summaryMs),
    ).toBe(true);
    expect(
      shouldRefresh(
        saved,
        start + 86400000,
        false,
        PRODUCTION_INTERVALS.summaryMs,
      ),
    ).toBe(false);
  });

  it('does not authorize a second job while one is already running', () => {
    expect(
      shouldRefresh(
        { ...saved, running: true },
        start + 86400000,
        true,
        PRODUCTION_INTERVALS.summaryMs,
      ),
    ).toBe(false);
  });

  it('honors retry backoff even if a first summary is missing', () => {
    const failed = {
      lastSuccessAt: null,
      retryNotBefore: start + 60000,
      running: false,
    };
    expect(
      shouldRefresh(failed, start, true, PRODUCTION_INTERVALS.summaryMs),
    ).toBe(false);
    expect(
      shouldRefresh(
        failed,
        start + 60000,
        true,
        PRODUCTION_INTERVALS.summaryMs,
      ),
    ).toBe(true);
  });
});
