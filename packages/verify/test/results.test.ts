import { describe, expect, it } from 'vitest';
import { collectRuns, headlineFor, parseOutcome, summarize } from '../src/index';
import { session } from './helpers';

describe('parseOutcome', () => {
  it('parses outcomes and strips colour codes', () => {
    expect(parseOutcome('test', '\u001b[31m Tests  2 failed\u001b[0m | 14 passed', false)).toBe('fail');
    expect(parseOutcome('test', ' Test Files  3 passed (3)\n Tests  14 passed (14)', false)).toBe('pass');
    expect(parseOutcome('test', 'ok  \tgithub.com/x/y\t0.21s', false)).toBe('pass');
    expect(parseOutcome('test', 'some unrelated text', false)).toBe('unknown');
    expect(parseOutcome('typecheck', 'src/a.ts(3,1): error TS2322: nope', false)).toBe('fail');
  });

  it('treats isError as fail for a non-test class regardless of the output text', () => {
    expect(parseOutcome('build', 'built in 1.2s', true)).toBe('fail');
  });

  it('does not fail a test run merely because its command errored: a recognised failing summary is required', () => {
    expect(parseOutcome('test', 'No module named pytest', true)).toBe('unknown');
  });

  it('still fails an errored test run when the output has a recognised failing summary', () => {
    expect(parseOutcome('test', '2 failed, 8 passed', true)).toBe('fail');
  });

  it('does not treat a zero count as a failure marker', () => {
    expect(parseOutcome('test', '0 failed, 14 passed', false)).toBe('pass');
  });

  it('still detects a failure count that appears after an earlier zero count', () => {
    expect(parseOutcome('test', '0 failed, 14 passed\nSuite 2: 3 failing', false)).toBe('fail');
  });

  it('recognises typecheck pass and fail markers', () => {
    expect(parseOutcome('typecheck', 'Found 0 errors', false)).toBe('pass');
    expect(parseOutcome('typecheck', '', false, { exitTrusted: true })).toBe('pass');
    expect(parseOutcome('typecheck', '', false)).toBe('unknown');
    expect(parseOutcome('typecheck', 'Found 3 errors', false)).toBe('fail');
  });

  it('recognises build and lint pass/fail/unknown markers', () => {
    expect(parseOutcome('build', 'compiled successfully', false)).toBe('pass');
    expect(parseOutcome('build', '3 errors', false)).toBe('fail');
    expect(parseOutcome('lint', 'something unexpected', false)).toBe('unknown');
    expect(parseOutcome('lint', '0 problems', false)).toBe('pass');
  });

  it('trusts a clean exit for typecheck when the output has no recognised marker', () => {
    expect(parseOutcome('typecheck', '$ tsc --noEmit', false, { exitTrusted: true })).toBe('pass');
  });

  it('does not trust the exit status when exitTrusted is false, even with the same clean output', () => {
    expect(parseOutcome('typecheck', '$ tsc --noEmit', false, { exitTrusted: false })).toBe('unknown');
    expect(parseOutcome('typecheck', '$ tsc --noEmit', false)).toBe('unknown');
  });

  it('still fails on a recognised error marker whatever the exit status', () => {
    expect(parseOutcome('typecheck', 'error TS2322: nope', false, { exitTrusted: true })).toBe('fail');
    expect(parseOutcome('typecheck', 'error TS2322: nope', false, { exitTrusted: false })).toBe('fail');
  });

  it('trusts a clean exit for lint and build too', () => {
    expect(parseOutcome('lint', 'no output the parser recognises', false, { exitTrusted: true })).toBe('pass');
    expect(parseOutcome('build', 'no output the parser recognises', false, { exitTrusted: true })).toBe('pass');
  });

  it('leaves the test class unaffected by exitTrusted: a recognised summary is still required', () => {
    expect(parseOutcome('test', 'some unrelated text', false, { exitTrusted: true })).toBe('unknown');
  });

  it('a piped typecheck command is not trusted, even on a clean exit', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm typecheck 2>&1 | tail -40' },
      { kind: 'tool_result', toolUseId: 't1', text: '$ tsc --noEmit', isError: false },
    ]);
    expect(collectRuns(sess)[0]!.outcome).toBe('unknown');
  });

  it('a plain typecheck command is trusted on a clean exit', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm typecheck' },
      { kind: 'tool_result', toolUseId: 't1', text: '$ tsc --noEmit', isError: false },
    ]);
    expect(collectRuns(sess)[0]!.outcome).toBe('pass');
  });

  it('a backgrounded typecheck command is not trusted: its reported status is the shell starting the job, not the check', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm typecheck &' },
      { kind: 'tool_result', toolUseId: 't1', text: '$ tsc --noEmit', isError: false },
    ]);
    expect(collectRuns(sess)[0]!.outcome).toBe('unknown');
  });

  it('a newline-separated script is not trusted: a newline chains statements exactly as ; does', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm typecheck\necho done' },
      { kind: 'tool_result', toolUseId: 't1', text: '$ tsc --noEmit\ndone', isError: false },
    ]);
    expect(collectRuns(sess)[0]!.outcome).toBe('unknown');
  });

  it('an && chain is still trusted: every part must run to completion for the chain to report success', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm typecheck && echo done' },
      { kind: 'tool_result', toolUseId: 't1', text: '$ tsc --noEmit\ndone', isError: false },
    ]);
    expect(collectRuns(sess)[0]!.outcome).toBe('pass');
  });

  it('a command whose earlier summary failed and whose last passed is evidence for neither verdict', () => {
    // A test-first script: it fails on purpose (RED), then the real implementation passes (GREEN). It is not a
    // failed run, and it is not a clean pass either: the earlier failure may belong to another suite.
    expect(parseOutcome('test', '== RED: 1 failed in 0.30s == GREEN: 75 passed in 0.85s', false)).toBe('unknown');
  });

  it('the same two summaries in the other order take the outcome of the new last one', () => {
    expect(parseOutcome('test', '== GREEN: 75 passed in 0.85s == RED: 1 failed in 0.30s', false)).toBe('fail');
  });

  it('a failure needs a recognised failing summary, not the word: a compound command that aborts with no summary is unknown', () => {
    expect(parseOutcome('test', "fatal: cannot create '.git/index.lock': File exists\nAborting", false)).toBe('unknown');
  });

  it('a recognised failing summary with a nonzero count still fails', () => {
    expect(parseOutcome('test', '18 failed, 265 passed in 1.10s', false)).toBe('fail');
  });
});

describe('summarize', () => {
  it('reads the last of two summaries in one output, in either order', () => {
    expect(summarize('test', '== RED: 1 failed in 0.30s == GREEN: 75 passed in 0.85s')).toEqual({ passed: 75, failed: null, outcome: 'unknown' });
    expect(summarize('test', '== GREEN: 75 passed in 0.85s == RED: 1 failed in 0.30s')).toEqual({ passed: null, failed: 1, outcome: 'fail' });
  });

  it('reads a combined failed/passed summary as one event', () => {
    expect(summarize('test', '18 failed, 265 passed in 1.10s')).toEqual({ passed: 265, failed: 18, outcome: 'fail' });
  });

  it('reports no summary at all as unknown, with no counts', () => {
    expect(summarize('test', "fatal: cannot create '.git/index.lock': File exists\nAborting")).toEqual({ passed: null, failed: null, outcome: 'unknown' });
  });

  it('reads the jest-style summary with a skipped count in between', () => {
    expect(summarize('test', 'Tests:       2 failed, 1 skipped, 12 passed, 15 total')).toEqual({ passed: 12, failed: 2, outcome: 'fail' });
  });

  it('reads a go package pass line with no counts', () => {
    expect(summarize('test', 'ok  \tgithub.com/x/y\t0.21s')).toEqual({ passed: null, failed: null, outcome: 'pass' });
  });

  it('reads a cargo result marker with no counts', () => {
    expect(summarize('test', 'test result: FAILED. 8 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out')).toEqual({ passed: null, failed: 2, outcome: 'fail' });
  });
});

describe('headlineFor', () => {
  it('reads the decisive fragment from vitest output, picking the overall Tests summary over Test Files', () => {
    expect(headlineFor('test', '\u001b[31m Tests  2 failed\u001b[0m | 14 passed')).toBe('2 failed');
    expect(headlineFor('test', ' Test Files  3 passed (3)\n Tests  14 passed (14)')).toBe('14 passed');
  });

  it('reads the decisive fragment from jest output', () => {
    expect(headlineFor('test', 'Tests:       2 failed, 1 skipped, 12 passed, 15 total')).toBe('2 failed');
  });

  it('reads the decisive fragment from pytest output', () => {
    expect(headlineFor('test', '5 passed in 0.42s')).toBe('5 passed');
  });

  it('returns null for a go test pass with no numeric summary', () => {
    expect(headlineFor('test', 'ok  \tgithub.com/x/y\t0.21s')).toBeNull();
  });

  it('reads the decisive fragment from tsc output, zero and nonzero', () => {
    expect(headlineFor('typecheck', 'Found 0 errors')).toBe('0 errors');
    expect(headlineFor('typecheck', 'Found 3 errors in 2 files.')).toBe('3 errors');
  });

  it('returns null when there is nothing decisive to report', () => {
    expect(headlineFor('build', 'compiled successfully')).toBeNull();
  });

  it('is at most 24 characters', () => {
    const headline = headlineFor('test', '123456789012345678901234567890 passed');
    expect(headline).not.toBeNull();
    expect(headline!.length).toBeLessThanOrEqual(24);
  });
});

describe('collectRuns on what Claude Code records', () => {
  const session = (command: string, text: string, isError = false) =>
    ({
      id: 's1',
      entries: [
        { id: 'e1', sessionId: 's1', index: 0, kind: 'tool_call', text: '', command, toolUseId: 't1' },
        { id: 'e2', sessionId: 's1', index: 1, kind: 'tool_result', text, toolUseId: 't1', isError },
      ],
    }) as unknown as Parameters<typeof collectRuns>[0];

  it('reads a silent type check with a stream redirect as a pass', () => {
    expect(collectRuns(session('npx tsc --noEmit 2>&1', '(Bash completed with no output)'))[0]).toMatchObject({ cls: 'typecheck', outcome: 'pass' });
  });

  it('still does not trust a backgrounded command', () => {
    expect(collectRuns(session('pnpm build &', 'started'))[0]).toMatchObject({ cls: 'build', outcome: 'unknown' });
  });

  it('records no run for a commit whose message names a runner', () => {
    expect(collectRuns(session('git commit -m "cover it with vitest"', '[main 274af55] cover it with vitest'))).toEqual([]);
  });
});

describe('silence is a pass only with the exit status of the command itself', () => {
  const run = (command: string, text: string, isError = false) =>
    collectRuns({
      id: 's1',
      entries: [
        { id: 'e1', sessionId: 's1', index: 0, kind: 'tool_call', text: '', command, toolUseId: 't1' },
        { id: 'e2', sessionId: 's1', index: 1, kind: 'tool_result', text, toolUseId: 't1', isError },
      ],
    } as unknown as Parameters<typeof collectRuns>[0])[0];

  it('does not read a silent type check as a pass when something after it decides the exit status', () => {
    expect(run('npx tsc --noEmit >/dev/null 2>&1; echo', '(Bash completed with no output)')).toMatchObject({ outcome: 'unknown' });
    expect(run('npx tsc --noEmit 2>&1 | tail -5', '')).toMatchObject({ outcome: 'unknown' });
    expect(run('pnpm lint | grep -v warning', '')).toMatchObject({ cls: 'lint', outcome: 'unknown' });
  });

  it('reads a silent, unpiped check as a pass, and an errored one as a failure', () => {
    expect(run('npx tsc --noEmit', '')).toMatchObject({ outcome: 'pass' });
    expect(run('npx tsc --noEmit > /dev/null 2>&1', '', true)).toMatchObject({ outcome: 'fail' });
  });
});
