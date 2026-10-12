import { describe, it, expect } from 'vitest';
import { DEFAULT_BUDGET } from '../src/index';

describe('DEFAULT_BUDGET', () => {
  it('sets maxCostPerReelUsd to 1.0, above the ~$0.60 a real 12-session run costs', () => {
    expect(DEFAULT_BUDGET.maxCostPerReelUsd).toBe(1.0);
  });

  it('leaves the other limits as they were', () => {
    expect(DEFAULT_BUDGET.maxTtsCalls).toBe(3);
    expect(DEFAULT_BUDGET.maxRenderSec).toBe(300);
  });
});
