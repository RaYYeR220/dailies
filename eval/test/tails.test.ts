import { describe, expect, it } from 'vitest';
import { unrecognisedTails } from '../src/tails';
import { session } from './helpers';

describe('unrecognisedTails', () => {
  it('counts and ranks unrecognised output tails, most common first, capped at 200 characters', () => {
    const makeSession = (id: string, text: string) =>
      session(
        [
          { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
          { kind: 'tool_result', toolUseId: 't1', text, isError: false },
        ],
        { id },
      );

    const sessions = [makeSession('s1', 'weird output A'), makeSession('s2', 'weird output A'), makeSession('s3', 'weird output B')];

    const result = unrecognisedTails(sessions, 10);
    expect(result[0]).toEqual({ tail: 'weird output A', count: 2 });
    expect(result[1]).toEqual({ tail: 'weird output B', count: 1 });
  });

  it('ignores recognised outcomes and caps the result at the given limit', () => {
    const sessions = [
      session([
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
        { kind: 'tool_result', toolUseId: 't1', text: 'Tests  14 passed (14)', isError: false },
      ]),
    ];
    expect(unrecognisedTails(sessions, 10)).toHaveLength(0);
  });

  it('redacts secrets from the tail text and only looks at the last 200 characters', () => {
    const text = `SHOULD_NOT_APPEAR ${'y'.repeat(230)} AKIAABCDEFGHIJKLMNOP leaked`;
    const sessions = [
      session([
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't1', command: 'pnpm test' },
        { kind: 'tool_result', toolUseId: 't1', text, isError: false },
      ]),
    ];
    const result = unrecognisedTails(sessions, 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.tail).not.toContain('SHOULD_NOT_APPEAR');
    expect(result[0]!.tail).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(result[0]!.tail).toContain('[REDACTED:aws_key_id]');
  });
});
