import { describe, it, expect } from 'vitest';
import { Scene, Storyboard } from '@dailies/core';
import { LIMITS, clampEnd, clampStart, countUp, fitLine, fitSize, parseHunk, tailLines, textUnits, windowRows } from '../src/remotion/text';
import { fixtureStoryboard, stressStoryboard } from './fixture';

describe('clampEnd', () => {
  it('leaves text within the limit untouched', () => {
    expect(clampEnd('retry queue', 11)).toBe('retry queue');
  });
  it('cuts to the limit and ends with an ellipsis', () => {
    expect(clampEnd('abcdefghij', 5)).toBe('abcd…');
    expect(clampEnd('x'.repeat(300), 280)).toHaveLength(280);
  });
  it('drops the space left hanging before the ellipsis', () => {
    expect(clampEnd('ab cd ef', 4)).toBe('ab…');
  });
  it('never splits an emoji', () => {
    expect(clampEnd('ok 🎉🎉🎉', 5)).toBe('ok 🎉…');
  });
});

describe('clampStart', () => {
  it('keeps the tail of a long path', () => {
    expect(clampStart('src/queue.ts', 20)).toBe('src/queue.ts');
    expect(clampStart('packages/pipeline/src/stages/render.ts', 20)).toBe('…rc/stages/render.ts');
  });
});

describe('tailLines', () => {
  const output = ' FAIL  test/queue.test.ts\n\nAssertionError: expected 1 to be 3\r\n\n Test Files  1 failed (1)\n      Tests  1 failed | 4 passed (5)\n\n';

  it('returns every non-blank line when they fit', () => {
    expect(tailLines(output, 6, 80)).toEqual({
      skipped: 0,
      lines: [' FAIL  test/queue.test.ts', 'AssertionError: expected 1 to be 3', ' Test Files  1 failed (1)', '      Tests  1 failed | 4 passed (5)'],
    });
  });
  it('keeps the end of the output and counts what it left out, spending one row on the marker', () => {
    expect(tailLines(output, 3, 80)).toEqual({ skipped: 2, lines: [' Test Files  1 failed (1)', '      Tests  1 failed | 4 passed (5)'] });
  });
  it('cuts long lines to the column limit and expands tabs', () => {
    expect(tailLines('\tat Queue.run (src/queue.ts:44:13)', 2, 17)).toEqual({ skipped: 0, lines: ['  at Queue.run (…'] });
  });
  it('returns nothing for empty output', () => {
    expect(tailLines('  \n\n', 4, 80)).toEqual({ skipped: 0, lines: [] });
  });
});

describe('parseHunk', () => {
  it('classifies added, removed and context lines and strips the marker column', () => {
    const rows = parseHunk('@@ -1,3 +1,3 @@ fn\n keep\n-old\n+new\n\n\\ No newline at end of file');
    expect(rows).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,3 @@ fn' },
      { kind: 'context', text: 'keep' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'context', text: '' },
    ]);
  });
  it('drops the file header in front of the first hunk', () => {
    const rows = parseHunk('diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b');
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'del', 'add']);
  });
  it('keeps a removed line that itself starts with dashes', () => {
    expect(parseHunk('@@ -1 +0,0 @@\n--- old comment')).toEqual([{ kind: 'hunk', text: '@@ -1 +0,0 @@' }, { kind: 'del', text: '-- old comment' }]);
  });
  it('matches the counters of the fixture patch', () => {
    const scene = fixtureStoryboard().scenes[3]!;
    if (scene.type !== 'diff') throw new Error('fixture changed');
    const rows = parseHunk(scene.hunk);
    expect(rows.filter((r) => r.kind === 'add')).toHaveLength(scene.added);
    expect(rows.filter((r) => r.kind === 'del')).toHaveLength(scene.removed);
  });
});

describe('windowRows', () => {
  const rows = parseHunk(['@@ -1,12 +1,13 @@', ' c1', ' c2', ' c3', ' c4', ' c5', ' c6', '-d1', '+a1', '+a2', ' c7', ' c8', ' c9'].join('\n'));

  it('returns everything when it fits', () => {
    expect(windowRows(rows, 13)).toEqual({ rows, hidden: 0 });
  });
  it('slides to the densest run of changes and spends one row on the count of rows left out', () => {
    const w = windowRows(rows, 6);
    expect(w.hidden).toBe(8);
    expect(w.rows.map((r) => r.text)).toEqual(['c5', 'c6', 'd1', 'a1', 'a2']);
  });
});

describe('countUp', () => {
  it('shows the value verbatim once the count is done', () => {
    for (const v of ['128', '1,234', '87%', '007', '$0.42', 'n/a', '3h 12m']) expect(countUp(v, 1)).toBe(v);
  });
  it('counts whole numbers from zero', () => {
    expect(countUp('128', 0)).toBe('0');
    expect(countUp('128', 0.5)).toBe('64');
  });
  it('keeps separators, decimals and the text around the number', () => {
    expect(countUp('12,345', 0.25)).toBe('3,086');
    expect(countUp('$0.40', 0.5)).toBe('$0.20');
    expect(countUp('96 min', 0.5)).toBe('48 min');
    expect(countUp('87%', 0.1)).toBe('9%');
  });
  it('leaves a value without a number alone', () => {
    expect(countUp('n/a', 0.3)).toBe('n/a');
  });
});

describe('fitSize', () => {
  const type = { max: 100, min: 20, advance: 0.5, leading: 1 };

  it('uses the largest size when the text is short', () => {
    expect(fitSize(4, { width: 1000, height: 100 }, type)).toBe(100);
  });
  it('shrinks until the text fits the box with room for ragged line ends', () => {
    expect(fitSize(20, { width: 1000, height: 100 }, type)).toBe(83);    // 24 columns * 1 row * 0.85 >= 20
    expect(fitSize(200, { width: 1000, height: 300 }, type)).toBe(50);   // 40 columns * 6 rows * 0.85 >= 200
  });
  it('never goes below the minimum', () => {
    expect(fitSize(100_000, { width: 1000, height: 100 }, type)).toBe(20);
  });
});

describe('fitLine', () => {
  const type = { max: 100, min: 20, advance: 0.5 };

  it('fits a single line to a width', () => {
    expect(fitLine(10, 1000, type)).toBe(100);
    expect(fitLine(40, 1000, type)).toBe(46);     // 40 glyphs * 0.5 em * 46 px <= 92% of 1000 px
    expect(fitLine(400, 1000, type)).toBe(20);
  });
});

describe('textUnits', () => {
  it('counts plain lowercase Latin text one unit per character', () => {
    expect(textUnits('retry queue')).toBe(11);
  });
  it('weighs capitals and non-Latin letters as broader, and full-width glyphs and emoji as wider still', () => {
    expect(textUnits('ABC')).toBeCloseTo(3.9);
    expect(textUnits('тест')).toBeCloseTo(5.2);
    expect(textUnits('日本')).toBeCloseTo(4.8);
    expect(textUnits('🎉')).toBeCloseTo(2.4);
  });
  it('makes a Cyrillic quote fit at a smaller size than a Latin one of the same length', () => {
    const type = { max: 92, min: 46, advance: 0.42, leading: 1.2 };
    const box = { width: 1600, height: 560 };
    expect(fitSize(textUnits('д'.repeat(280)), box, type)).toBeLessThan(fitSize(textUnits('d'.repeat(280)), box, type));
  });
});

describe('LIMITS', () => {
  const [, prompt, terminal, diff, stats, flag] = fixtureStoryboard().scenes as [unknown, any, any, any, any, any];
  const cases: [keyof typeof LIMITS, (text: string) => unknown][] = [
    ['promptQuote', (quote) => ({ ...prompt, quote })],
    ['command', (command) => ({ ...terminal, steps: [{ ...terminal.steps[0], command }] })],
    ['output', (output) => ({ ...terminal, steps: [{ ...terminal.steps[0], output }] })],
    ['hunk', (hunk) => ({ ...diff, hunk })],
    ['statLabel', (label) => ({ ...stats, items: [{ ...stats.items[0], label }] })],
    ['statValue', (value) => ({ ...stats, items: [{ ...stats.items[0], value }] })],
    ['flagQuote', (quote) => ({ ...flag, quote })],
    ['flagReality', (reality) => ({ ...flag, reality })],
    ['line', (text) => ({ ...prompt, lines: [{ ...prompt.lines[0], text }] })],
  ];

  it('mirrors the limits the core schema enforces', () => {
    expect(cases.map(([key]) => key).sort()).toEqual(Object.keys(LIMITS).sort());
    for (const [key, scene] of cases) {
      expect(Scene.safeParse(scene('x'.repeat(LIMITS[key]))).success, `${key} at the limit`).toBe(true);
      expect(Scene.safeParse(scene('x'.repeat(LIMITS[key] + 1))).success, `${key} past the limit`).toBe(false);
    }
  });

  it('is what the stress fixture is filled to', () => {
    const sb = stressStoryboard();
    expect(Storyboard.parse(sb)).toEqual(sb);
    const [, p, t, d, s, f] = sb.scenes as [unknown, any, any, any, any, any];
    expect(p.quote).toHaveLength(LIMITS.promptQuote);
    expect(t.steps).toHaveLength(4);
    expect(t.steps[0].command).toHaveLength(LIMITS.command);
    expect(t.steps[0].output).toHaveLength(LIMITS.output);
    expect(d.hunk).toHaveLength(LIMITS.hunk);
    expect(s.items).toHaveLength(6);
    expect(s.items[0].label).toHaveLength(LIMITS.statLabel);
    expect(s.items[0].value).toHaveLength(LIMITS.statValue);
    expect(f.quote).toHaveLength(LIMITS.flagQuote);
    expect(f.reality).toHaveLength(LIMITS.flagReality);
    expect(p.lines[0].text).toHaveLength(LIMITS.line);
  });
});
