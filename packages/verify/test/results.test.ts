import { describe, expect, it } from 'vitest';
import { parseOutcome } from '../src/index';

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
});
