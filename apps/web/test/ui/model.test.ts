import { describe, it, expect } from 'vitest';
import { evidenceHref, formatCost, lineAt, markFor, stageStates } from '../../src/ui/model';

describe('markFor', () => {
  it('gives each of the four verdicts its own pencil mark', () => {
    expect(markFor('verified')).toBe('ring');
    expect(markFor('contradicted')).toBe('cross');
    expect(markFor('stale')).toBe('dashed');
    expect(markFor('unverifiable')).toBe('question');
  });
});

describe('stageStates', () => {
  const NINE = ['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'review', 'gate'];

  it('maps three done stages, one running and five waiting, in pipeline order', () => {
    const states = stageStates([
      { name: 'ingest', status: 'done' },
      { name: 'edit', status: 'done' },
      { name: 'verify', status: 'done' },
      { name: 'script', status: 'running' },
      { name: 'ground', status: 'pending' },
      { name: 'voice', status: 'pending' },
      { name: 'render', status: 'pending' },
      { name: 'review', status: 'pending' },
      { name: 'gate', status: 'pending' },
    ]);
    expect(states.map((s) => s.name)).toEqual(NINE);
    expect(states.map((s) => s.state)).toEqual([
      'done', 'done', 'done', 'running', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting',
    ]);
  });

  it('always returns the nine stages, whatever order or subset it is given', () => {
    const states = stageStates([
      { name: 'verify', status: 'failed' },
      { name: 'ingest', status: 'done' },
      { name: 'not-a-stage', status: 'done' },
    ]);
    expect(states.map((s) => s.name)).toEqual(NINE);
    expect(states[0]).toEqual({ name: 'ingest', state: 'done' });
    expect(states[1]).toEqual({ name: 'edit', state: 'waiting' });
    expect(states[2]).toEqual({ name: 'verify', state: 'failed' });
    expect(stageStates([]).every((s) => s.state === 'waiting')).toBe(true);
  });

  it('treats a status it does not know as waiting, never as done', () => {
    expect(stageStates([{ name: 'ingest', status: 'exploded' }])[0]!.state).toBe('waiting');
  });
});

describe('lineAt', () => {
  const timings = [
    { lineId: 'l1', startSec: 0, endSec: 3.6 },
    { lineId: 'l2', startSec: 3.6, endSec: 7 },
    { lineId: 'l3', startSec: 8, endSec: 10.2 },
  ];

  it('is null before the first line: the title plays before the narration starts', () => {
    expect(lineAt(timings, 0, 2.5)).toBeNull();
    expect(lineAt(timings, 2.49, 2.5)).toBeNull();
  });

  it('names the line being spoken, shifted by the audio offset', () => {
    expect(lineAt(timings, 2.5, 2.5)).toBe('l1');
    expect(lineAt(timings, 6.0, 2.5)).toBe('l1');
    expect(lineAt(timings, 6.2, 2.5)).toBe('l2');
    expect(lineAt(timings, 11, 2.5)).toBe('l3');
  });

  it('is null in a pause between two lines and after the last one', () => {
    expect(lineAt(timings, 10, 2.5)).toBeNull();
    expect(lineAt(timings, 12.7, 2.5)).toBeNull();
    expect(lineAt(timings, 60, 2.5)).toBeNull();
  });

  it('is null when there are no timings', () => {
    expect(lineAt([], 3, 2.5)).toBeNull();
  });
});

describe('evidenceHref', () => {
  const repo = 'https://github.com/acme/api';

  it('links a diff ref to its commit on GitHub', () => {
    expect(evidenceHref({ type: 'diff', sha: '3f9c2ab71d0e4c55', path: 'src/queue.ts' }, repo)).toBe(
      'https://github.com/acme/api/commit/3f9c2ab71d0e4c55',
    );
  });

  it('drops a .git suffix and a trailing slash from the repository URL', () => {
    const ref = { type: 'diff', sha: 'abc1234', path: 'a.ts' } as const;
    expect(evidenceHref(ref, 'https://github.com/acme/api.git')).toBe('https://github.com/acme/api/commit/abc1234');
    expect(evidenceHref(ref, 'https://github.com/acme/api/')).toBe('https://github.com/acme/api/commit/abc1234');
  });

  it('is null for entry and stat refs', () => {
    expect(evidenceHref({ type: 'entry', entryId: 's1:14' }, repo)).toBeNull();
    expect(evidenceHref({ type: 'stat', key: 'sessions.count' }, repo)).toBeNull();
  });

  it('is null rather than a guess when the sha or the repository is not what it should be', () => {
    expect(evidenceHref({ type: 'diff', sha: '../../settings', path: 'a.ts' }, repo)).toBeNull();
    expect(evidenceHref({ type: 'diff', sha: 'abc1234', path: 'a.ts' }, 'https://evil.example/acme/api')).toBeNull();
    expect(evidenceHref({ type: 'diff', sha: 'abc1234', path: 'a.ts' }, 'javascript:alert(1)')).toBeNull();
  });
});

describe('formatCost', () => {
  it('writes the spend against the budget in dollars and cents', () => {
    expect(formatCost(0.31, 0.6)).toBe('$0.31 of $0.60');
    expect(formatCost(0, 0.6)).toBe('$0.00 of $0.60');
    expect(formatCost(1.2345, 2)).toBe('$1.23 of $2.00');
  });
});
