import type { CostMeter } from '@dailies/agent';

export class StageBudgetError extends Error {}

/**
 * Tracks what a stage has spent on `meter` since this call, against its own slice of the run
 * budget. `check()` throws once that spend passes `shareUsd`; what an earlier stage already spent
 * does not count against this share.
 *
 * The baseline resets on every call, so a stage that retries (`Stage.maxAttempts`) gets a fresh
 * share on each attempt rather than one shared across its attempts for the run. The run's overall
 * `CostMeter` limit is the hard backstop regardless; this share is the earlier, softer trigger for
 * a stage's own fallback, and a cross-attempt baseline would need a place to persist it that
 * survives a process restart, which belongs with the run record, not here.
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
