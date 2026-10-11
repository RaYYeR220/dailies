import type { CostMeter } from '@dailies/agent';

export class StageBudgetError extends Error {}

/**
 * Tracks what a stage has spent on `meter` since this call, against its own slice of the run
 * budget. `check()` throws once that spend passes `shareUsd`; what an earlier stage already spent
 * does not count against this share.
 */
export function stageMeter(meter: CostMeter, shareUsd: number): { check(): void; spent(): number } {
  const before = meter.total();
  const spent = () => meter.total() - before;
  return {
    spent,
    check(): void {
      const amount = spent();
      if (amount > shareUsd) throw new StageBudgetError(`stage spent $${amount.toFixed(4)} past its $${shareUsd.toFixed(4)} budget share`);
    },
  };
}
