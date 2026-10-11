import { describe, it, expect } from 'vitest';
import { BudgetExceededError } from '@dailies/core';
import { CostMeter } from '../src/meter';

describe('CostMeter', () => {
  it('CostMeter.assertWithin throws BudgetExceededError past the limit', () => {
    const m = new CostMeter(0.01);
    m.add(0.02);
    expect(() => m.assertWithin()).toThrow(BudgetExceededError);
  });

  it('tracks total spend across multiple add calls', () => {
    const m = new CostMeter(1);
    m.add(0.1);
    m.add(0.25);
    expect(m.total()).toBeCloseTo(0.35);
  });

  it('does not throw when spend is within the limit', () => {
    const m = new CostMeter(1);
    m.add(0.5);
    expect(() => m.assertWithin()).not.toThrow();
  });
});
