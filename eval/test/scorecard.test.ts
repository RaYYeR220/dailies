import { describe, expect, it } from 'vitest';
import { buildScorecard } from '../src/index';
import { repoKey } from '../src/index';
import type { MutationCase } from '../src/index';

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

  it('scrubs the repository URL out of free-text command and reason fields', () => {
    const url = 'https://github.com/acme/widgets';
    const cases: MutationCase[] = [
      {
        repo: url,
        sessionId: 's9',
        command: `git clone ${url} repo && pnpm test`,
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
    ];
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases, recognised: 1, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      // NoCheckpointsError's message literally embeds the repo URL this way.
      skipped: [{ repo: url, reason: `no checkpoint refs found in ${url}` }],
    });
    expect(md).not.toContain(url);
    expect(md.match(new RegExp(repoKey(url), 'g'))!.length).toBeGreaterThanOrEqual(3);
  });

  it('neutralises markdown-breaking characters in untrusted command, reason and tail text', () => {
    const cases: MutationCase[] = [
      {
        repo: 'https://github.com/acme/widgets',
        sessionId: 's1',
        command: 'echo "a | b"\nand more',
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
    ];
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases, recognised: 1, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [{ repo: 'https://github.com/other/repo', reason: 'line one\nline two' }],
      tails: [{ tail: 'weird `output`\nwith a newline', count: 3 }],
    });

    expect(md).toContain('a \\| b');
    expect(md.split('\n').some((l) => l.trim() === 'and more')).toBe(false);
    expect(md.split('\n').some((l) => l.trim() === 'line two')).toBe(false);
    expect(md).not.toContain('`output`');
    expect(md.split('\n').some((l) => l.trim() === 'with a newline')).toBe(false);
  });

  it('escapes a pre-existing backslash before escaping a pipe, so the two cannot cancel out', () => {
    // If `|` were escaped before `\`, a pre-existing "\|" would become "\\|" — markdown reads the
    // first two backslashes as one escaped backslash, leaving the pipe unescaped and breaking the
    // table out from under the cell it was meant to stay inside of. Splitting the row on raw `|`
    // characters can't tell an escaped pipe from a bare one, so this asserts the exact escaped
    // form markdown needs: "\\" (-> literal "\") immediately followed by "\|" (-> literal "|").
    const cases: MutationCase[] = [
      {
        repo: 'https://github.com/acme/widgets',
        sessionId: 's1',
        command: 'echo a\\|b', // one backslash, then a pipe
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
    ];
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases, recognised: 1, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [],
    });
    const expectedCommand = `echo a${'\\'.repeat(3)}|b`;
    expect(md).toContain(expectedCommand);
  });
});
