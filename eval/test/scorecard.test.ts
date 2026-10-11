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

  it('never prints the raw command: a session-local path, username or repo slug it carries cannot leak', () => {
    // Real transcripts record commands like these verbatim, straight from the agent's shell
    // calls — full local filesystem paths (with the operator's username in them) and bare
    // "github.com/owner/repo" module paths with no scheme for scrubRepo's URL match to catch.
    const leakyCommand =
      "cd /Users/peytonmontei/Documents/entire/devenv/entireio/cli/.worktrees/review-child-context && " +
      'perl -0pi -e \'s/"github.com\\/entireio\\/cli\\/internal\\/coreapi"//\' foo.go && go test ./...';
    const cases: MutationCase[] = [
      {
        repo: 'https://github.com/entireio/cli',
        sessionId: 's1',
        command: leakyCommand,
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

    expect(md).not.toContain('peytonmontei');
    expect(md).not.toContain('entireio');
    expect(md).not.toContain('/Users/');
    expect(md).not.toContain(leakyCommand);
    // Still carries a little signal: the command's class and its first (program-name) token.
    expect(md).toContain('test:cd');
  });

  it('never prints a leading VAR=value assignment or an unrecognised binary name as the program', () => {
    const cases: MutationCase[] = [
      {
        repo: 'https://github.com/acme/widgets',
        sessionId: 's1',
        command: 'MYSQL_PWD=hunter2 pnpm test',
        original: 'pass',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
      {
        repo: 'https://github.com/acme/widgets',
        sessionId: 's2',
        command: '/opt/some-vendor-tool --flag=/Users/alice/secret test',
        original: 'fail',
        verdictBefore: 'verified',
        verdictAfter: 'verified',
        flipped: false,
      },
    ];
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases, recognised: 2, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [],
    });
    expect(md).not.toContain('hunter2');
    expect(md).not.toContain('MYSQL_PWD');
    expect(md).not.toContain('alice');
    expect(md).not.toContain('some-vendor-tool');
    expect(md).toContain('test:pnpm');
    expect(md).toContain('other:other');
  });

  it('scrubs the repository URL out of the skipped-repo reason field', () => {
    const url = 'https://github.com/acme/widgets';
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases: [], recognised: 0, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      // NoCheckpointsError's message literally embeds the repo URL this way.
      skipped: [{ repo: url, reason: `no checkpoint refs found in ${url}` }],
    });
    expect(md).not.toContain(url);
    expect(md.match(new RegExp(repoKey(url), 'g'))!.length).toBeGreaterThanOrEqual(2);
  });

  it('neutralises markdown-breaking characters in untrusted reason and tail text', () => {
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases: [], recognised: 0, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [{ repo: 'https://github.com/other/repo', reason: 'line one\nline two | three' }],
      tails: [{ tail: 'weird `output`\nwith a newline', count: 3 }],
    });

    expect(md).toContain('line one line two \\| three');
    expect(md.split('\n').some((l) => l.trim() === 'line two | three')).toBe(false);
    expect(md).not.toContain('`output`');
    expect(md.split('\n').some((l) => l.trim() === 'with a newline')).toBe(false);
  });

  it('escapes a pre-existing backslash before escaping a pipe, so the two cannot cancel out', () => {
    // If `|` were escaped before `\`, a pre-existing "\|" would become "\\|" — markdown reads the
    // first two backslashes as one escaped backslash, leaving the pipe unescaped. Reason text is
    // still rendered raw (unlike command, which is reduced to a safe class:programName form), so
    // it still needs this protection.
    const md = buildScorecard({
      date: '2026-10-12',
      mutation: { cases: [], recognised: 0, unknown: 0, flipRate: 0 },
      grounding: { fabricated: 20, rejected: 20, genuine: 20, accepted: 20 },
      skipped: [{ repo: 'https://github.com/other/repo', reason: 'path a\\|b' }],
    });
    const expectedReason = `path a${'\\'.repeat(3)}|b`;
    expect(md).toContain(expectedReason);
  });
});
