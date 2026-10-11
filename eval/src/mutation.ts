import type { Claim, Session } from '@dailies/core';
import { collectRuns, verifyClaim } from '@dailies/verify';
import { mutateRun, syntheticClaim } from './synthetic';

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

export function runMutationBenchmark(
  sessions: { repo: string; session: Session }[],
): { cases: MutationCase[]; recognised: number; unknown: number; flipRate: number } {
  const cases: MutationCase[] = [];
  let recognised = 0;
  let unknown = 0;

  for (const { repo, session } of sessions) {
    for (const run of collectRuns(session)) {
      if (run.outcome === 'unknown') {
        unknown += 1;
        continue;
      }
      recognised += 1;
      const original = run.outcome;

      const before = syntheticClaim(session, run);
      if (!before) continue;

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
  return { cases, recognised, unknown, flipRate };
}
