import { describe, expect, it } from 'vitest';
import { checkLine } from '../src/index';
import { session } from './helpers';
import type { DiffIndex, Facts, Line } from '@dailies/core';

const sess = session([{ kind: 'assistant', text: 'Touched 3 files in this change.' }]);
const facts: Facts = { 'files.count': 3 };
const diffs: DiffIndex = { 'abc123:src/retry.ts': '+function retry() {\n+  return true;\n+}' };

describe('checkLine', () => {
  it('accepts a clean line with grounded evidence', () => {
    const line: Line = {
      id: 'l1',
      text: 'The change touched 3 files.',
      evidence: [{ type: 'stat', key: 'files.count' }],
    };
    expect(checkLine(line, { sessions: [sess], facts, diffs })).toEqual({ ok: true, reasons: [] });
  });

  it('rejects an unknown entry ref', () => {
    const line: Line = {
      id: 'l2',
      text: 'The agent said so.',
      evidence: [{ type: 'entry', entryId: 'missing:0', quote: 'x' }],
    };
    const result = checkLine(line, { sessions: [sess], facts, diffs });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('missing:0'))).toBe(true);
  });

  it('rejects a number not backed by any referenced evidence', () => {
    const line: Line = {
      id: 'l3',
      text: 'The change touched 5 files.',
      evidence: [{ type: 'stat', key: 'files.count' }],
    };
    const result = checkLine(line, { sessions: [sess], facts, diffs });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('5'))).toBe(true);
  });

  it('rejects a banned phrase even when the evidence is otherwise clean', () => {
    const line: Line = {
      id: 'l4',
      text: 'This is a robust fix.',
      evidence: [{ type: 'stat', key: 'files.count' }],
    };
    const result = checkLine(line, { sessions: [sess], facts, diffs });
    expect(result.ok).toBe(false);
  });

  it('rejects an entry ref whose quote is not in the entry', () => {
    const line: Line = {
      id: 'l5',
      text: 'Something happened.',
      evidence: [{ type: 'entry', entryId: sess.entries[0]!.id, quote: 'nonexistent phrase' }],
    };
    expect(checkLine(line, { sessions: [sess], facts, diffs }).ok).toBe(false);
  });

  it('rejects a diff ref missing from the diff index', () => {
    const line: Line = {
      id: 'l6',
      text: 'Patched the retry loop.',
      evidence: [{ type: 'diff', sha: 'zzz', path: 'src/x.ts', quote: 'retry' }],
    };
    expect(checkLine(line, { sessions: [sess], facts, diffs }).ok).toBe(false);
  });

  it('does not ground a number via an unrelated larger number containing it as a substring', () => {
    const noisySess = session([{ kind: 'assistant', text: 'Session id 31 started the run.' }]);
    const line: Line = {
      id: 'l8',
      text: 'Fixed issue 3 in the backlog.',
      evidence: [{ type: 'entry', entryId: noisySess.entries[0]!.id, quote: 'Session id 31 started the run.' }],
    };
    const result = checkLine(line, { sessions: [noisySess], facts, diffs });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('3'))).toBe(true);
  });

  it('does not ground a number that is only a substring of an alphanumeric code', () => {
    const codeSess = session([{ kind: 'assistant', text: 'src/a.ts(3,1): error TS2322: nope' }]);
    const line: Line = {
      id: 'l10',
      text: 'Fixed 2322 issues in the codebase.',
      evidence: [{ type: 'entry', entryId: codeSess.entries[0]!.id, quote: 'error TS2322' }],
    };
    const result = checkLine(line, { sessions: [codeSess], facts, diffs });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('2322'))).toBe(true);
  });

  it('does not treat an inherited object property as a known stat', () => {
    const line: Line = {
      id: 'l9',
      text: 'Touched 1 files.',
      evidence: [{ type: 'stat', key: 'constructor' }],
    };
    const result = checkLine(line, { sessions: [sess], facts, diffs });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('constructor'))).toBe(true);
  });

  it('skips the style lint when skipStyle is set', () => {
    const line: Line = {
      id: 'l7',
      text: 'This is a robust fix.',
      evidence: [{ type: 'stat', key: 'files.count' }],
    };
    expect(checkLine(line, { sessions: [sess], facts, diffs }, { skipStyle: true }).ok).toBe(true);
  });
});
