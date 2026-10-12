import { describe, it, expect } from 'vitest';
import { computeFacts, type Session } from '../src/index';

const session = (startedAt: string, endedAt: string | null): Session => ({
  id: `s-${startedAt}`,
  checkpointIds: ['cp'],
  agent: 'claude-code',
  model: null,
  branch: 'main',
  startedAt,
  endedAt,
  turnCount: 1,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  commits: [],
  filesTouched: [],
  entries: [],
} as unknown as Session);

describe('computeFacts', () => {
  it('adds up the minutes of the sessions that have a length', () => {
    const facts = computeFacts([session('2026-10-10T10:00:00Z', '2026-10-10T10:07:00Z'), session('2026-10-10T11:00:00Z', '2026-10-10T11:04:00Z')]);
    expect(facts['duration.minutes']).toBe(11);
  });

  it('does not count a session that ends before it starts, or has no end, as time', () => {
    const facts = computeFacts([
      session('2026-10-10T18:07:08Z', '2026-10-10T18:05:05Z'),
      session('2026-10-10T12:14:10Z', null),
      session('2026-10-10T15:22:00Z', '2026-10-10T15:22:15Z'),
    ]);
    expect(facts['duration.minutes']).toBe(0);
  });
});
