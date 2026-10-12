import { describe, expect, it } from 'vitest';
import { CostMeter } from '@dailies/agent';
import { StageBudgetError, stageMeter } from '../src/budget';

describe('stageMeter', () => {
  it('does not throw while the stage stays within its share', () => {
    const meter = new CostMeter(10);
    const budget = stageMeter(meter, 1);

    budget.check();
    meter.add(1);
    expect(() => budget.check()).not.toThrow();
    expect(budget.spent()).toBeCloseTo(1);
  });

  it('throws StageBudgetError once the stage spends past its share', () => {
    const meter = new CostMeter(10);
    const budget = stageMeter(meter, 1);

    meter.add(1.01);
    expect(() => budget.check()).toThrow(StageBudgetError);
  });

  it('counts only what was spent after the meter was wrapped, not an earlier stage\'s spend', () => {
    const meter = new CostMeter(10);
    meter.add(5); // spent by a stage that ran before this one

    const budget = stageMeter(meter, 1);
    meter.add(0.9);

    expect(() => budget.check()).not.toThrow();
    expect(budget.spent()).toBeCloseTo(0.9);
  });
});
