import { z } from 'zod';
export const Budget = z.object({ maxCostPerReelUsd: z.number(), maxTtsCalls: z.number().int(), maxRenderSec: z.number() });
export type Budget = z.infer<typeof Budget>;
export const DEFAULT_BUDGET: Budget = { maxCostPerReelUsd: 0.6, maxTtsCalls: 3, maxRenderSec: 300 };
export class BudgetExceededError extends Error {
  constructor(public spentUsd: number, public limitUsd: number) { super(`budget exceeded: ${spentUsd.toFixed(4)} > ${limitUsd}`); }
}
