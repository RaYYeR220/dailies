import type { Claim, Session } from '@dailies/core';
import { collectRuns, verifyClaim } from '@dailies/verify';
import { claimAnchor, isEvidencingRun, mutateRun, syntheticClaim } from './synthetic';

type Verdict = NonNullable<Claim['verdict']>;

export interface MutationCase {
  repo: string;
  sessionId: string;
  command: string;
  original: 'pass' | 'fail';
  verdictBefore: Verdict;
  verdictAfter: Verdict;
  flipped: boolean;
}

const NOT_EVIDENCING_REASON = 'not the last run before the next message';

export function runMutationBenchmark(sessions: { repo: string; session: Session }[]): {
  cases: MutationCase[];
  recognised: number;
  unknown: number;
  flipRate: number;
  version: 2;
  eligible: number;
  ineligible: number;
  ineligibleReasons: Record<string, number>;
} {
  const cases: MutationCase[] = [];
  let recognised = 0;
  let unknown = 0;
  let eligible = 0;
  const ineligibleReasons: Record<string, number> = {};

  const bumpIneligible = (reason: string) => {
    ineligibleReasons[reason] = (ineligibleReasons[reason] ?? 0) + 1;
  };

  for (const { repo, session } of sessions) {
    for (const run of collectRuns(session)) {
      if (run.outcome === 'unknown') {
        unknown += 1;
        continue;
      }
      recognised += 1;
      const original = run.outcome;

      const { gap } = claimAnchor(session, run);
      if (gap) {
        bumpIneligible(gap);
        continue;
      }

      const before = syntheticClaim(session, run)!;
      if (!isEvidencingRun(session, run, before)) {
        bumpIneligible(NOT_EVIDENCING_REASON);
        continue;
      }
      eligible += 1;

      const verdictBefore = verifyClaim(before, session).verdict as Verdict;
      const mutated = mutateRun(session, run, original === 'pass' ? 'fail' : 'pass');
      const verdictAfter = verifyClaim(before, mutated).verdict as Verdict;

      const expectedBefore: Verdict = original === 'pass' ? 'verified' : 'contradicted';
      const expectedAfter: Verdict = original === 'pass' ? 'contradicted' : 'verified';

      cases.push({
        repo,
        sessionId: session.id,
        command: run.command,
        original,
        verdictBefore,
        verdictAfter,
        flipped: verdictBefore === expectedBefore && verdictAfter === expectedAfter,
      });
    }
  }

  const flipRate = cases.length === 0 ? 0 : cases.filter((c) => c.flipped).length / cases.length;
  const ineligible = Object.values(ineligibleReasons).reduce((a, b) => a + b, 0);
  return { cases, recognised, unknown, flipRate, version: 2, eligible, ineligible, ineligibleReasons };
}
