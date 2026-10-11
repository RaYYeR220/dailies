import { describe, expect, it } from 'vitest';
import { fallbackBeats, outlineSession, outlinesWithin } from '../src/outline';
import { FAILED_RUN, PASSED_RUN, SHA_A, SHA_B, session } from './stages/fixture';

describe('outlineSession', () => {
  it('summarises a session: trimmed prompt and last message, runs in order, edit count', () => {
    const s = session(
      's1',
      [
        { kind: 'user', text: 'Please fix the retry bug in the queue worker so it backs off correctly.' },
        { kind: 'assistant', text: 'Looking at the queue now.' },
        { kind: 'tool_call', toolName: 'Edit', toolUseId: 't1', filePath: 'src/queue.ts', text: '{}' },
        { kind: 'tool_result', toolUseId: 't1', text: 'ok' },
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm vitest run', text: '{}' },
        { kind: 'tool_result', toolUseId: 't2', text: FAILED_RUN, isError: true },
        { kind: 'tool_call', toolName: 'Edit', toolUseId: 't3', filePath: 'src/queue.ts', text: '{}' },
        { kind: 'tool_result', toolUseId: 't3', text: 'ok' },
        { kind: 'tool_call', toolName: 'Bash', toolUseId: 't4', command: 'pnpm vitest run', text: '{}' },
        { kind: 'tool_result', toolUseId: 't4', text: PASSED_RUN },
        { kind: 'assistant', text: 'The retry now backs off and all tests pass.' },
      ],
      { commits: [SHA_A], filesTouched: ['src/queue.ts'] },
    );

    const outline = outlineSession(s);

    expect(outline.id).toBe('s1');
    expect(outline.agent).toBe('claude-code');
    expect(outline.turns).toBe(1);
    expect(outline.entries).toBe(11);
    expect(outline.firstPrompt).toBe('Please fix the retry bug in the queue worker so it backs off correctly.');
    expect(outline.lastMessage).toBe('The retry now backs off and all tests pass.');
    expect(outline.edits).toBe(2);
    expect(outline.runs).toEqual(['test fail @4', 'test pass @8']);
    expect(outline.commits).toEqual([SHA_A]);
    expect(outline.files).toEqual(['src/queue.ts']);
  });

  it('cuts the first prompt and the last message to 240 characters', () => {
    const s = session('long', [{ kind: 'user', text: 'p'.repeat(500) }, { kind: 'assistant', text: 'a'.repeat(500) }]);

    const outline = outlineSession(s);

    expect(outline.firstPrompt).toHaveLength(240);
    expect(outline.lastMessage).toHaveLength(240);
  });

  it('caps commits, files and runs', () => {
    const manyRuns = Array.from({ length: 20 }, (_, n) => [
      { kind: 'tool_call' as const, toolName: 'Bash', toolUseId: `t${n}`, command: 'pnpm vitest run', text: '{}' },
      { kind: 'tool_result' as const, toolUseId: `t${n}`, text: PASSED_RUN },
    ]).flat();
    const s = session('many', [{ kind: 'user', text: 'go' }, ...manyRuns], {
      commits: Array.from({ length: 10 }, (_, n) => String(n).padStart(40, '0')),
      filesTouched: Array.from({ length: 10 }, (_, n) => `file${n}.ts`),
    });

    const outline = outlineSession(s);

    expect(outline.commits).toHaveLength(6);
    expect(outline.files).toHaveLength(8);
    expect(outline.runs).toHaveLength(12);
  });

  it('gives a session with no user entry an empty first prompt, not a throw', () => {
    const s = session('silent', [{ kind: 'assistant', text: 'hello?' }]);
    expect(outlineSession(s).firstPrompt).toBe('');
  });
});

describe('outlinesWithin', () => {
  it('keeps every session and fits the limit for 12 long sessions', () => {
    const sessions = Array.from({ length: 12 }, (_, n) =>
      session(`s${n}`, [
        { kind: 'user', text: `Session ${n} prompt. ${'detail '.repeat(100)}` },
        { kind: 'assistant', text: `Session ${n} wrap-up. ${'notes '.repeat(100)}` },
      ]),
    );

    const outlines = outlinesWithin(sessions, 9000);

    expect(outlines).toHaveLength(12);
    expect(outlines.map((o) => o.id)).toEqual(sessions.map((s) => s.id));
    expect(JSON.stringify(outlines).length).toBeLessThanOrEqual(9000);
  });

  it('does not trim text that already fits', () => {
    const sessions = [session('s1', [{ kind: 'user', text: 'short' }, { kind: 'assistant', text: 'ok' }])];

    const outlines = outlinesWithin(sessions, 9000);

    expect(outlines[0]!.firstPrompt).toBe('short');
    expect(outlines[0]!.lastMessage).toBe('ok');
  });
});

describe('fallbackBeats', () => {
  it('orders newest sessions with commits first, and ranges each beat over the whole session', () => {
    const noCommitsOld = session('old-no-commits', [{ kind: 'user', text: 'a' }, { kind: 'assistant', text: 'b' }], {
      startedAt: '2026-01-01T00:00:00Z',
      commits: [],
    });
    const commitsOld = session('old-commits', [{ kind: 'user', text: 'c' }, { kind: 'assistant', text: 'd' }], {
      startedAt: '2026-01-02T00:00:00Z',
      commits: [SHA_A],
    });
    const commitsNew = session('new-commits', [{ kind: 'user', text: 'e' }, { kind: 'assistant', text: 'f' }, { kind: 'assistant', text: 'g' }], {
      startedAt: '2026-01-03T00:00:00Z',
      commits: [SHA_B],
    });
    const noCommitsNew = session('new-no-commits', [{ kind: 'user', text: 'h' }, { kind: 'assistant', text: 'i' }], {
      startedAt: '2026-01-04T00:00:00Z',
      commits: [],
    });

    const beats = fallbackBeats([noCommitsOld, commitsOld, commitsNew, noCommitsNew], 6);

    expect(beats.map((b) => b.sessionIds[0])).toEqual(['new-commits', 'old-commits', 'new-no-commits', 'old-no-commits']);
    expect(beats.every((b) => b.kind === 'feature')).toBe(true);
    const newCommitsBeat = beats.find((b) => b.sessionIds[0] === 'new-commits')!;
    expect(newCommitsBeat.entryRanges).toEqual([{ sessionId: 'new-commits', from: 0, to: 2 }]);
    expect(newCommitsBeat.commits).toEqual([SHA_B]);
  });

  it('keeps at most max beats, each with a unique sequential id', () => {
    const sessions = Array.from({ length: 8 }, (_, n) => session(`s${n}`, [{ kind: 'user', text: 'x' }]));

    const beats = fallbackBeats(sessions, 6);

    expect(beats).toHaveLength(6);
    expect(beats.map((b) => b.id)).toEqual(['beat_1', 'beat_2', 'beat_3', 'beat_4', 'beat_5', 'beat_6']);
  });
});
