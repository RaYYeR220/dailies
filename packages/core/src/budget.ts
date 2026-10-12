import { z } from 'zod';
export const Budget = z.object({ maxCostPerReelUsd: z.number(), maxTtsCalls: z.number().int(), maxRenderSec: z.number() });
export type Budget = z.infer<typeof Budget>;
// The most one reel may cost and still leave the business plan's 55% gross margin on its cheapest plan
// (Solo: $29 a month for 20 reels, so $29 x 0.45 / 20). The plan was built in cfo.ai; its tables and this
// number are in business/plan.json, and a test holds the two together.
export const PLAN_COST_CEILING_USD = 0.6525;
export const DEFAULT_BUDGET: Budget = { maxCostPerReelUsd: PLAN_COST_CEILING_USD, maxTtsCalls: 3, maxRenderSec: 300 };
export class BudgetExceededError extends Error {
  constructor(public spentUsd: number, public limitUsd: number) { super(`budget exceeded: ${spentUsd.toFixed(4)} > ${limitUsd}`); }
}
