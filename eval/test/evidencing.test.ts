import { describe, expect, it } from 'vitest';
import { collectRuns } from '@dailies/verify';
import { isEvidencingRun, syntheticClaim } from '../src/index';
import { session } from './helpers';

describe('isEvidencingRun', () => {
  it('is true only for the last of three same-class runs before one message', () => {
    const sess = session([
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't1', text: 'Tests  3 failed | 11 passed', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't2', text: 'Tests  3 failed | 11 passed', isError: true },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't3', command: 'pnpm test' },
      { kind: 'tool_result', toolUseId: 't3', text: 'Tests  14 passed (14)', isError: false },
      { kind: 'assistant', text: 'All tests pass now.' },
    ]);
    const runs = collectRuns(sess);
    expect(runs).toHaveLength(3);

    const claim = syntheticClaim(sess, runs[2]!)!;
    expect(claim).not.toBeNull();

    expect(isEvidencingRun(sess, runs[0]!, claim)).toBe(false);
    expect(isEvidencingRun(sess, runs[1]!, claim)).toBe(false);
    expect(isEvidencingRun(sess, runs[2]!, claim)).toBe(true);
  });
});
