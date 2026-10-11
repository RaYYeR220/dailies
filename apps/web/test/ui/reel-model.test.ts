import { describe, it, expect } from 'vitest';
import {
  claimCounts,
  decisive,
  entryLabel,
  flagRows,
  focusOf,
  lensOf,
  narrationLines,
  resolveSource,
  sceneSpans,
  srtToVtt,
} from '../../src/ui/reel-model';
import { claims, SHA, storyboard, timings } from './fixtures';

const OFFSET = 2.5;

describe('narrationLines', () => {
  it('lists every line in storyboard order with its start in video time', () => {
    const lines = narrationLines(storyboard(), timings(), OFFSET);
    expect(lines.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7']);
    expect(lines[0]).toMatchObject({ sceneId: 'sc_prompt', sceneType: 'prompt', startSec: 2.5, endSec: 6.1 });
    expect(lines[3]!.startSec).toBeCloseTo(12.7);
  });

  it('rings a grounded line and gives the lines of a flag scene the mark of its verdict', () => {
    const lines = narrationLines(storyboard(), timings(), OFFSET);
    expect(lines.slice(0, 5).every((l) => l.mark === 'ring')).toBe(true);
    expect(lines[5]!.mark).toBe('cross');

    const stale = storyboard();
    const flag = stale.scenes[5]!;
    if (flag.type === 'flag') flag.verdict = 'stale';
    expect(narrationLines(stale, timings(), OFFSET)[6]!.mark).toBe('dashed');
  });

  it('leaves out a line that has no timing: it was dropped before the voice stage', () => {
    const lines = narrationLines(storyboard(), timings().filter((t) => t.lineId !== 'l3'), OFFSET);
    expect(lines.map((l) => l.id)).toEqual(['l1', 'l2', 'l4', 'l5', 'l6', 'l7']);
  });

  it('keeps every line, untimed, when the voice stage has not reported', () => {
    const lines = narrationLines(storyboard(), null, OFFSET);
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.startSec === null && l.endSec === null)).toBe(true);
  });
});

describe('sceneSpans', () => {
  it('cuts the video where the renderer does: title, a scene per first line, a tail, the end card', () => {
    const spans = sceneSpans(storyboard(), timings(), OFFSET)!;
    expect(spans.map((s) => s.sceneId)).toEqual(['sc_title', 'sc_prompt', 'sc_terminal', 'sc_diff', 'sc_stats', 'sc_flag', 'sc_end']);
    const at = spans.map((s) => [Number(s.startSec.toFixed(2)), Number(s.endSec.toFixed(2))]);
    expect(at).toEqual([[0, 2.5], [2.5, 6.1], [6.1, 12.7], [12.7, 16.5], [16.5, 20], [20, 27.5], [27.5, 30.5]]);
  });

  it('skips a spoken scene whose lines were all dropped', () => {
    const spans = sceneSpans(storyboard(), timings().filter((t) => t.lineId !== 'l4'), OFFSET)!;
    expect(spans.map((s) => s.sceneId)).not.toContain('sc_diff');
    expect(spans.find((s) => s.sceneId === 'sc_terminal')!.endSec).toBeCloseTo(16.5);
  });

  it('is null without timings', () => {
    expect(sceneSpans(storyboard(), null, OFFSET)).toBeNull();
    expect(sceneSpans(storyboard(), [], OFFSET)).toBeNull();
  });
});

describe('entryLabel', () => {
  it('reads the session and the index out of an entry id', () => {
    expect(entryLabel('s3:204')).toBe('session s3 · entry 204');
  });

  it('shortens a long session id', () => {
    expect(entryLabel('0f3a9c21-7b54-4e19-a1c3-5d2e8f6b9a70:12')).toBe('session 0f3a9c21 · entry 12');
  });

  it('falls back to the raw id when it has no index', () => {
    expect(entryLabel('whatever')).toBe('entry whatever');
  });
});

describe('resolveSource', () => {
  const ctx = { storyboard: storyboard(), claims: claims() };

  it('opens an entry ref on the human prompt', () => {
    expect(resolveSource({ type: 'entry', entryId: 's1:1' }, ctx)).toEqual({
      kind: 'entry', role: 'prompt', where: 'session s1 · entry 1', quote: null,
      body: 'Add retry with backoff to the webhook sender, and make sure the tests cover the timeout path.',
    });
  });

  it('opens an entry ref on a recorded command with its output', () => {
    const source = resolveSource({ type: 'entry', entryId: 's3:204', quote: '2 failed | 12 passed' }, ctx);
    expect(source).toMatchObject({ kind: 'entry', role: 'command', command: 'pnpm test', ok: false, quote: '2 failed | 12 passed' });
    expect(source.kind === 'entry' && source.body).toContain('Tests  2 failed | 12 passed (14)');
  });

  it('opens an entry ref on what the agent wrote', () => {
    expect(resolveSource({ type: 'entry', entryId: 's3:212' }, ctx)).toMatchObject({ kind: 'entry', role: 'agent', body: 'All 14 tests pass.' });
  });

  it('shows only the reference when the page was not given the entry text', () => {
    expect(resolveSource({ type: 'entry', entryId: 's9:3' }, ctx)).toEqual({ kind: 'entry', role: 'entry', where: 'session s9 · entry 3', quote: null, body: null });
    expect(resolveSource({ type: 'entry', entryId: 's9:3', quote: 'ok' }, ctx)).toMatchObject({ quote: 'ok', body: null });
  });

  it('opens a diff ref on the patch of the diff scene for the same commit and file', () => {
    const source = resolveSource({ type: 'diff', sha: SHA, path: 'src/webhooks/send.ts', quote: 'attempt < 4' }, ctx);
    expect(source).toMatchObject({ kind: 'diff', path: 'src/webhooks/send.ts', sha: SHA, added: 6, removed: 2, quote: 'attempt < 4' });
    expect(source.kind === 'diff' && source.hunk).toContain('for (let attempt = 0; attempt < 4; attempt++) {');
  });

  it('keeps a diff ref without a matching scene as a reference with no patch', () => {
    expect(resolveSource({ type: 'diff', sha: 'abc1234', path: 'README.md' }, ctx)).toEqual({
      kind: 'diff', path: 'README.md', sha: 'abc1234', hunk: null, added: null, removed: null, quote: null,
    });
  });

  it('opens a stat ref on the labelled value, or on the recorded fact', () => {
    expect(resolveSource({ type: 'stat', key: 'commits.count' }, ctx)).toEqual({ kind: 'stat', key: 'commits.count', label: 'Commits', value: '9' });
    expect(resolveSource({ type: 'stat', key: 'files.count' }, ctx)).toEqual({ kind: 'stat', key: 'files.count', label: 'files.count', value: '11' });
    expect(resolveSource({ type: 'stat', key: 'nope' }, ctx)).toEqual({ kind: 'stat', key: 'nope', label: 'nope', value: null });
  });
});

describe('decisive', () => {
  it('pulls the failure count out of a test summary', () => {
    expect(decisive(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 12 passed (14)')).toBe('2 failed');
  });

  it('pulls the pass count when nothing failed', () => {
    expect(decisive(' Test Files  4 passed (4)\n      Tests  14 passed (14)')).toBe('14 passed');
    expect(decisive('===== 31 passed in 2.10s =====')).toBe('31 passed');
  });

  it('is null for output it does not recognise, never a pass', () => {
    expect(decisive('Done in 4.2s')).toBeNull();
    expect(decisive('')).toBeNull();
  });
});

describe('focusOf', () => {
  const ctx = { storyboard: storyboard(), claims: claims() };

  it('puts the quoted span under the glass when the ref carries one', () => {
    expect(focusOf(resolveSource({ type: 'diff', sha: SHA, path: 'src/webhooks/send.ts', quote: 'attempt < 4' }, ctx))).toBe('attempt < 4');
  });

  it('puts the decisive part of a command output under the glass', () => {
    expect(focusOf(resolveSource({ type: 'entry', entryId: 's4:219' }, ctx))).toBe('14 passed');
  });

  it('puts the value of a stat under the glass', () => {
    expect(focusOf(resolveSource({ type: 'stat', key: 'commits.count' }, ctx))).toBe('9');
  });

  it('reads the count out of a quoted span of command output', () => {
    expect(focusOf(resolveSource({ type: 'entry', entryId: 's3:204', quote: '2 failed | 12 passed' }, ctx))).toBe('2 failed');
  });

  it('cuts a long passage to its opening words with an ellipsis, short enough to read in a small lens', () => {
    const focus = focusOf(resolveSource({ type: 'entry', entryId: 's1:1' }, ctx));
    expect(focus).toBe('Add retry…');
    expect(focus.length).toBeLessThanOrEqual(14);
  });

  it('falls back to the reference when there is nothing to read', () => {
    expect(focusOf(resolveSource({ type: 'entry', entryId: 's9:3' }, ctx))).toBe('entry 3');
    expect(focusOf(resolveSource({ type: 'diff', sha: 'abc1234', path: 'docs/README.md' }, ctx))).toBe('README.md');
  });
});

describe('lensOf', () => {
  const ctx = { storyboard: storyboard(), claims: claims() };
  const sources = (lineId: string) =>
    storyboard().scenes.flatMap((s) => s.lines).find((l) => l.id === lineId)!.evidence.map((ref) => resolveSource(ref, ctx));

  it('prefers the source that quotes a span, in the code face', () => {
    expect(lensOf(sources('l4'))).toEqual({ focus: 'attempt < 4', face: 'code' });
  });

  it('sets a count or a value in the display face', () => {
    expect(lensOf(sources('l2'))).toEqual({ focus: '2 failed', face: 'disp' });
    expect(lensOf(sources('l5'))).toEqual({ focus: '4', face: 'disp' });
  });

  it('is null for a line with nothing behind it', () => {
    expect(lensOf([])).toBeNull();
  });
});

describe('flagRows and claimCounts', () => {
  it('lists contradicted claims first, then stale, then the ones nothing could settle', () => {
    const rows = flagRows(claims(), storyboard());
    expect(rows.map((r) => [r.id, r.verdict, r.mark])).toEqual([
      ['c_3', 'contradicted', 'cross'],
      ['c_5', 'stale', 'dashed'],
      ['c_4', 'unverifiable', 'question'],
      ['c_6', 'unverifiable', 'question'],
    ]);
  });

  it('states the recorded reality from the flag scene, else from the verdict reason', () => {
    const rows = flagRows(claims(), storyboard());
    expect(rows[0]).toMatchObject({ quote: 'All 14 tests pass.', reality: 'The last test run before that message had failed.', where: 'session s3 · entry 212' });
    expect(rows[1]!.reality).toBe('Code was edited after the last passing build.');
    expect(rows[3]!.reality).toBeNull();
  });

  it('counts a claim without a verdict as unverifiable, never as verified', () => {
    expect(claimCounts(claims())).toEqual({ verified: 2, contradicted: 1, stale: 1, unverifiable: 2, total: 6 });
  });
});

describe('srtToVtt', () => {
  it('turns the subtitle file the renderer writes into WebVTT a video track can load', () => {
    const srt = '1\r\n00:00:02,500 --> 00:00:06,100\r\nThe request was a retry.\r\n\r\n2\r\n00:00:06,100 --> 00:00:09,500\r\nThe first run failed.\r\n';
    expect(srtToVtt(srt)).toBe(
      'WEBVTT\n\n1\n00:00:02.500 --> 00:00:06.100\nThe request was a retry.\n\n2\n00:00:06.100 --> 00:00:09.500\nThe first run failed.\n',
    );
  });

  it('leaves commas in the text alone', () => {
    expect(srtToVtt('1\n00:00:01,000 --> 00:00:02,000\nOne, two, 3,000.\n')).toContain('One, two, 3,000.');
  });
});
