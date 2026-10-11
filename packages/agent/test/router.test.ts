import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from '../src/router';

describe('estimateCostUsd', () => {
  it('prices known models from the per-million-token table', () => {
    expect(estimateCostUsd('claude-sonnet-4.6', 1_000_000, 1_000_000)).toBeCloseTo(3 + 15);
    expect(estimateCostUsd('claude-haiku', 1_000_000, 1_000_000)).toBeCloseTo(1 + 5);
    expect(estimateCostUsd('nova-pro', 1_000_000, 1_000_000)).toBeCloseTo(0.8 + 3.2);
  });

  it('falls back to a conservative non-zero estimate for an unpriced model, so budget tracking fails closed', () => {
    const cost = estimateCostUsd('some-unlisted-venice-model', 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });
});
