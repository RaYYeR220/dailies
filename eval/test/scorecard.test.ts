import { describe, expect, it } from 'vitest';
import { buildScorecard } from '../src/scorecard';
import { repoKey } from '../src/repoKey';
import type { MutationCase } from '../src/mutation';

describe('buildScorecard', () => {
  it('lists non-flipping cases by repoKey and never contains a repository URL', () => {
    const url = 'https://github.com/acme/widgets';
    const cases: MutationCase[] = [
      {
        repo: url,
        sessionId: 's1',
        command: 'pnpm test',
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
      {
        repo: url,
        sessionId: 's2',
        command: 'pnpm run build',
        original: 'fail',
        verdictBefore: 'contradicted',
        verdictAfter: 'verified',
        flipped: true,
      },
    ];

    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases, recognised: 2, unknown: 1, flipRate: 0.5 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [{ repo: url, reason: 'clone failed' }],
    });

    expect(md).not.toContain(url);
    expect(md).toContain(repoKey(url));
    expect(md).toContain('s1');
    expect(md).not.toContain('s2');
    expect(md).toContain('2026-10-12');
    expect(md).toContain('20');
  });
});
