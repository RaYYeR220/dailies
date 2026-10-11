import { describe, expect, it } from 'vitest';
import { collectRuns, headlineFor, parseOutcome } from '../src/index';
import { session } from './helpers';

describe('parseOutcome', () => {
  it('parses outcomes and strips colour codes', () => {
    expect(parseOutcome('test', '\u001b[31m Tests  2 failed\u001b[0m | 14 passed', false)).toBe('fail');
    expect(parseOutcome('test', ' Test Files  3 passed (3)\n Tests  14 passed (14)', false)).toBe('pass');
    expect(parseOutcome('test', 'ok  \tgithub.com/x/y\t0.21s', false)).toBe('pass');
    expect(parseOutcome('test', 'some unrelated text', false)).toBe('unknown');
    expect(parseOutcome('typecheck', 'src/a.ts(3,1): error TS2322: nope', false)).toBe('fail');
  });

  it('treats isError as fail regardless of the output text', () => {
    expect(parseOutcome('test', '14 passed', true)).toBe('fail');
  });

  it('does not treat a zero count as a failure marker', () => {
    expect(parseOutcome('test', '0 failed, 14 passed', false)).toBe('pass');
  });

  it('still detects a failure count that appears after an earlier zero count', () => {
    expect(parseOutcome('test', '0 failed, 14 passed\nSuite 2: 3 failing', false)).toBe('fail');
  });

  it('recognises typecheck pass and fail markers', () => {
    expect(parseOutcome('typecheck', 'Found 0 errors', false)).toBe('pass');
    expect(parseOutcome('typecheck', '', false)).toBe('pass');
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
