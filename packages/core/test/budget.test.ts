import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DEFAULT_BUDGET, PLAN_COST_CEILING_USD } from '../src/index';

const plan = JSON.parse(readFileSync(fileURLToPath(new URL('../../../business/plan.json', import.meta.url)), 'utf8')) as {
  targetGrossMargin: number;
  pricing: { solo: { pricePerMonth: number; reelsPerMonth: number } };
  maxCostPerReelUsd: { solo: number };
};

describe('DEFAULT_BUDGET', () => {
  it('caps one reel at the cost ceiling of the business plan', () => {
    expect(DEFAULT_BUDGET.maxCostPerReelUsd).toBe(PLAN_COST_CEILING_USD);
    expect(PLAN_COST_CEILING_USD).toBe(plan.maxCostPerReelUsd.solo);
  });

  it('has a ceiling that is the plan\'s own arithmetic: the Solo price, less the target margin, over the reels a month', () => {
    const { pricePerMonth, reelsPerMonth } = plan.pricing.solo;
    expect((pricePerMonth * (1 - plan.targetGrossMargin)) / reelsPerMonth).toBeCloseTo(PLAN_COST_CEILING_USD, 10);
  });

  it('leaves the other limits as they were', () => {
    expect(DEFAULT_BUDGET.maxTtsCalls).toBe(3);
    expect(DEFAULT_BUDGET.maxRenderSec).toBe(300);
  });
});
