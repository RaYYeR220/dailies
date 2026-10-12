import { describe, it, expect } from 'vitest';
import { Scene, Storyboard } from '@dailies/core';
import { BREAKS, LIMITS, PROMPT_SHOWN, abbreviate, boxRoom, clampEnd, clampStart, clampWidth, clampWords, closingCount, commonIndent, countUp, cutToWidth, decisive, estimateEm, fitText, parseHunk, promptShown, sourceRef, splitLast, tailLines, textUnits, windowRows, wrap, type Em } from '../src/remotion/text';
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

describe('clampWords', () => {
  it('leaves text within the limit untouched', () => {
    expect(clampWords('add a retry', 11)).toBe('add a retry');
  });
  it('cuts after the last whole word that fits, ellipsis included in the limit', () => {
    expect(clampWords('Add a retry with backoff to the sender', 20)).toBe('Add a retry with…');
    expect(clampWords('Add a retry with backoff to the sender', 25)).toBe('Add a retry with backoff…');
    expect(Array.from(clampWords('word '.repeat(60), 190))).toHaveLength(190);
  });
  it('drops punctuation left hanging before the ellipsis', () => {
    expect(clampWords('Refactor the pipeline, and keep the flag', 23)).toBe('Refactor the pipeline…');
    expect(clampWords('Add a retry – with backoff', 14)).toBe('Add a retry…');
  });
  it('cuts inside a word only when there is no word to end on', () => {
    expect(clampWords('abcdefghijklmnop', 8)).toBe('abcdefg…');
    expect(clampWords('a bcdefghijklmnopqrstuvwxyz', 12)).toBe('a bcdefghij…');
  });
  it('never splits an emoji', () => {
    expect(clampWords('🎉🎉🎉🎉🎉🎉', 4)).toBe('🎉🎉🎉…');
  });
});

describe('promptShown', () => {
  it('shows a request of up to 190 characters whole, its line breaks flattened', () => {
    expect(PROMPT_SHOWN).toBe(190);
    expect(promptShown('  Add a retry.\n\n- with backoff\n- and a test ')).toBe('Add a retry. - with backoff - and a test');
    const whole = 'word '.repeat(38).trim();
    expect(whole).toHaveLength(189);
    expect(promptShown(whole)).toBe(whole);
  });
  it('cuts a longer request at a word and closes it with an ellipsis', () => {
    const [, prompt] = stressStoryboard().scenes as [unknown, { quote: string }];
    expect(prompt.quote).toHaveLength(LIMITS.promptQuote);
    const shown = promptShown(prompt.quote);
    expect(Array.from(shown).length).toBeLessThanOrEqual(PROMPT_SHOWN);
    expect(Array.from(shown).length).toBeGreaterThan(PROMPT_SHOWN - 20);
    expect(shown.endsWith('…')).toBe(true);
    const kept = shown.slice(0, -1);
    expect(prompt.quote.startsWith(kept)).toBe(true);
    expect(prompt.quote.slice(kept.length)).toMatch(/^[.,;:]?\s/);   // what was left out starts a new word
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

describe('abbreviate', () => {
  it('rounds a count of a thousand or more to one decimal of its unit', () => {
    expect(abbreviate('1493')).toBe('1.5k');
    expect(abbreviate('2000')).toBe('2k');
    expect(abbreviate('1234567')).toBe('1.2M');
    expect(abbreviate('2500000000')).toBe('2.5B');
  });
  it('drops the decimal from ten of a unit up', () => {
    expect(abbreviate('12345')).toBe('12k');
    expect(abbreviate('48210')).toBe('48k');
    expect(abbreviate('128900')).toBe('129k');
  });
  it('moves up a unit instead of writing a thousand of the smaller one', () => {
    expect(abbreviate('9960')).toBe('10k');
    expect(abbreviate('999950')).toBe('1M');
  });
  it('reads grouped digits and keeps what stands around the number', () => {
    expect(abbreviate('1,493')).toBe('1.5k');
    expect(abbreviate('1,234,567 tokens')).toBe('1.2M tokens');
    expect(abbreviate('$12,400')).toBe('$12k');
    expect(abbreviate('-1493')).toBe('-1.5k');
  });
  it('leaves alone a value under a thousand and a value that is not one number', () => {
    for (const value of ['0', '128', '999', '99.5%', 'n/a', '', '2026-10-11', '3 of 1493', '23:05']) expect(abbreviate(value), value).toBe(value);
  });
  it('still counts up to an abbreviated value', () => {
    expect(countUp(abbreviate('1493'), 0.5)).toBe('0.8k');
    expect(countUp(abbreviate('1493'), 1)).toBe('1.5k');
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
});

// Half an em per character: widths that can be checked by counting.
const em: Em = (text) => Array.from(text).length * 0.5;

describe('wrap', () => {
  it('breaks at spaces, filling each line as far as it goes', () => {
    expect(wrap('add retry with backoff to the sender', () => 8, em)).toEqual(['add retry with', 'backoff to the', 'sender']);
  });
  it('gives each line its own width', () => {
    expect(wrap('aa bb cc dd ee', (i) => [1, 2.5, 4][i] ?? 4, em)).toEqual(['aa', 'bb cc', 'dd ee']);
  });
  it('breaks prose after a hyphen or a slash, and a name after a dot or an underscore too', () => {
    expect(wrap('acme/retry-queue', () => 3, em)).toEqual(['acme/', 'retry-', 'queue']);
    expect(wrap('with_a.name', () => 3, em)).toEqual(['with_a', '.name']);
    expect(wrap('with_a.name', () => 3, em, BREAKS.name)).toEqual(['with_', 'a.name']);
  });
  it('splits a word that is longer than a line', () => {
    expect(wrap('abcdefghij kl', () => 2, em)).toEqual(['abcd', 'efgh', 'ij', 'kl']);
  });
  it('returns nothing for blank text', () => {
    expect(wrap('  \n ', () => 10, em)).toEqual([]);
  });
  it('never starts a line with a dash: the dash of a range stays with the word before it', () => {
    expect(wrap('11 Oct, 14:00 – 18:30', () => 6, em)).toEqual(['11 Oct,', '14:00 –', '18:30']);
    expect(wrap('11 Oct, 14:00 – 18:30', () => 7, em)).toEqual(['11 Oct,', '14:00 – 18:30']);
    expect(wrap('retry — then stop', () => 3.5, em)).toEqual(['retry —', 'then', 'stop']);
  });
});

describe('fitText', () => {
  const type = { max: 100, min: 40, leading: 1 };

  it('uses the largest size when the text is short', () => {
    expect(fitText('retry', type, boxRoom(1000, 200), em)).toEqual({ size: 100, lines: ['retry'], cut: false });
  });
  it('wraps before it shrinks, and shrinks until the lines fit the room', () => {
    const two = fitText('retry with backoff', type, boxRoom(600, 200), em);
    expect(two).toMatchObject({ size: 100, cut: false });
    expect(two.lines).toHaveLength(2);
    const one = fitText('retry with backoff', type, boxRoom(600, 100), em);
    expect(one.lines).toEqual(['retry with backoff']);
    expect(one.size).toBeLessThanOrEqual(600 / (18 * 0.5));
    expect(one.size).toBeGreaterThan(60);
  });
  it('evens the lines out instead of leaving a short last one', () => {
    const { lines } = fitText('one two three four five six seven', { max: 40, min: 40, leading: 1 }, boxRoom(400, 80), em);
    expect(lines).toEqual(['one two three four', 'five six seven']);
  });
  it('never sets text below the smallest size: what does not fit is cut with an ellipsis', () => {
    const fitted = fitText('x'.repeat(40) + ' ' + 'y'.repeat(400), type, boxRoom(400, 80), em);
    expect(fitted).toMatchObject({ size: 40, cut: true });
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.lines[1]!.endsWith('…')).toBe(true);
    for (const line of fitted.lines) expect(em(line) * fitted.size).toBeLessThanOrEqual(400);
  });
  it('honours a cap on the number of lines', () => {
    const fitted = fitText('a b c d e f g h', { max: 40, min: 40, leading: 1 }, boxRoom(40, 1000), em, { maxLines: 2 });
    expect(fitted.lines).toHaveLength(2);
    expect(fitted.cut).toBe(true);
  });
  it('fits lines to a room whose width changes from line to line', () => {
    // A lens: the middle line of three is the widest.
    const lens = (count: number, lineHeight: number) => (count * lineHeight > 300 ? null : Array.from({ length: count }, (_, i) => (Math.abs(i - (count - 1) / 2) < 0.75 ? 500 : 300)));
    const fitted = fitText('aaaa bbbb cccc dddd eeee ffff', { max: 50, min: 50, leading: 1 }, lens, em);
    expect(fitted.cut).toBe(false);
    fitted.lines.forEach((line, i) => expect(em(line) * 50).toBeLessThanOrEqual(lens(fitted.lines.length, 50)![i]!));
  });
  it('makes a Cyrillic quote fit at a smaller size than a Latin one of the same length', () => {
    const estimate = estimateEm(0.6);
    const quote = { max: 92, min: 40, leading: 1.2 };
    const room = boxRoom(1600, 300);
    expect(fitText('д'.repeat(8).concat(' ').repeat(30), quote, room, estimate).size).toBeLessThan(fitText('d'.repeat(8).concat(' ').repeat(30), quote, room, estimate).size);
  });
  it('sets a smaller size before it breaks a word in two', () => {
    // At 100 px the figure is wider than its frame; breaking it would fit two lines there, and must not happen.
    const fitted = fitText('128', type, boxRoom(120, 400), em, { maxLines: 2 });
    expect(fitted).toEqual({ size: 78, lines: ['128'], cut: false });   // 1.5 em at 78 px, just inside 120 px
  });
  it('breaks a word only when it does not fit at the smallest size either', () => {
    const fitted = fitText('1234567890', type, boxRoom(120, 400), em, { maxLines: 3 });
    expect(fitted.size).toBe(40);
    expect(fitted.lines.join('')).toBe('1234567890');
    expect(fitted.lines.length).toBeGreaterThan(1);
  });
  it('takes as few lines as it can, at a smaller size, when asked to', () => {
    const big = fitText('Last 7 days', type, boxRoom(400, 400), em);
    expect(big).toMatchObject({ size: 100 });
    expect(big.lines.length).toBeGreaterThan(1);
    expect(fitText('Last 7 days', type, boxRoom(400, 400), em, { fewest: true })).toMatchObject({ lines: ['Last 7 days'], cut: false });
  });
  it('returns no lines when there is no room at all', () => {
    expect(fitText('retry', type, () => null, em)).toEqual({ size: 40, lines: [], cut: true });
  });
});

describe('decisive', () => {
  const failed = ' FAIL  test/queue.test.ts > retries a failed job\nAssertionError: expected 1 to be 3\n\n Test Files  1 failed (1)\n      Tests  1 failed | 4 passed (5)';
  const passed = ' PASS  test/queue.test.ts (5 tests) 212ms\n\n Test Files  1 passed (1)\n      Tests  5 passed (5)';

  it('leads with the failures of a failing run and keeps what passed as the rest', () => {
    expect(decisive(failed, false)).toEqual({ kind: 'count', headline: '1 failed', detail: '4 passed' });
  });
  it('leads with what passed in a passing run', () => {
    expect(decisive(passed, true)).toEqual({ kind: 'count', headline: '5 passed', detail: null });
  });
  it('reads the totals of other runners', () => {
    expect(decisive('Tests:       2 failed, 12 passed, 14 total\nSnapshots:   0 total\nTime:        1.2 s', false)).toMatchObject({ headline: '2 failed', detail: '12 passed' });
    expect(decisive('===== 1 failed, 4 passed in 0.12s =====', false)).toMatchObject({ headline: '1 failed', detail: '4 passed' });
    expect(decisive('test result: ok. 5 passed; 0 failed; 0 ignored', true)).toMatchObject({ headline: '5 passed', detail: null });
    expect(decisive('  14 passing (2s)\n  1 pending', true)).toMatchObject({ headline: '14 passing' });
    expect(decisive('src/a.ts(3,1): error TS2304\nFound 3 errors in 2 files.', false)).toMatchObject({ headline: '3 errors' });
  });
  it('falls back to a count of anything when nothing passed or failed', () => {
    expect(decisive(' ✓ stage-1.test.ts (12 tests) 4ms\n ✓ stage-2.test.ts (12 t', true)).toMatchObject({ kind: 'count', headline: '12 tests' });
  });
  it('gives the last line of output that has no count in it', () => {
    expect(decisive('compiling…\n\nerror: could not   find `Cargo.toml`\n', false)).toEqual({ kind: 'line', headline: 'error: could not find `Cargo.toml`', detail: null });
  });
  it('shows the result the pipeline read, not a later count in the same output', () => {
    const vitest = ' Test Files  1 failed (1)\n      Tests  3 failed | 10 passed (13)\n     Errors  1 error\n   Start at  03:45:55';
    expect(decisive(vitest, false)).toMatchObject({ headline: '1 error' });
    expect(decisive(vitest, false, '3 failed')).toEqual({ kind: 'count', headline: '3 failed', detail: '10 passed' });
    expect(decisive('$ tsc --noEmit', true, '0 errors')).toEqual({ kind: 'count', headline: '0 errors', detail: null });
  });
  it('says only what the step itself says when there is no output', () => {
    expect(decisive(' \n', true)).toEqual({ kind: 'status', headline: 'ok', detail: null });
    expect(decisive('', false)).toEqual({ kind: 'status', headline: 'failed', detail: null });
  });
});

describe('cutToWidth and clampWidth', () => {
  it('shortens a line until it fits with its ellipsis', () => {
    expect(cutToWidth('pnpm vitest run', 5, em)).toBe('pnpm vite…');
    expect(em(cutToWidth('pnpm vitest run', 5, em))).toBeLessThanOrEqual(5);
  });
  it('drops the space left hanging before the ellipsis', () => {
    expect(cutToWidth('pnpm vitest run', 3, em)).toBe('pnpm…');
  });
  it('leaves a line that fits as it is', () => {
    expect(clampWidth('pnpm test', 4.5, em)).toBe('pnpm test');
    expect(clampWidth('pnpm test', 4, em)).toBe('pnpm te…');
  });
});

describe('closingCount', () => {
  it('splits a sentence that ends on a count', () => {
    expect(closingCount('Last test run before this message: 2 failed.')).toEqual({ lead: 'Last test run before this message:', count: '2 failed.' });
    expect(closingCount('The run after the edit reported 14 passed')).toEqual({ lead: 'The run after the edit reported', count: '14 passed' });
  });
  it('takes the last count when there are several', () => {
    expect(closingCount('Of 14 tests, 12 passed and 2 failed.')).toEqual({ lead: 'Of 14 tests, 12 passed and', count: '2 failed.' });
  });
  it('leaves alone a sentence that goes on after its count, or has none', () => {
    expect(closingCount('2 failed before the message was written.')).toBeNull();
    expect(closingCount('The last test run before that message had failed.')).toBeNull();
    expect(closingCount('2 failed.')).toBeNull();
  });
});

describe('commonIndent', () => {
  it('counts the whitespace every line starts with', () => {
    expect(commonIndent(['    a', '      b', '    c'])).toBe(4);
    expect(commonIndent(['a', '  b'])).toBe(0);
  });
  it('ignores blank lines', () => {
    expect(commonIndent(['  a', '', '   ', '  b'])).toBe(2);
    expect(commonIndent([])).toBe(0);
  });
});

describe('sourceRef', () => {
  it('leaves out the word session where there is little room', () => {
    expect(sourceRef('s2:31', true)).toBe('s2 · entry 31');
    expect(sourceRef('0f3a9c21-7b54-4e19-a1c3-5d2e8f6b9a70:212', true)).toBe('0f3a9c21… · entry 212');
  });
  it('names the session and the entry of an entry id', () => {
    expect(sourceRef('s2:31')).toBe('session s2 · entry 31');
  });
  it('shortens a long session id', () => {
    expect(sourceRef('0f3a9c21-7b54-4e19-a1c3-5d2e8f6b9a70:212')).toBe('session 0f3a9c21… · entry 212');
  });
  it('shows an id of another shape as it is', () => {
    expect(sourceRef('c_7')).toBe('c_7');
    expect(sourceRef(':4')).toBe(':4');
  });
});

describe('splitLast', () => {
  it('splits a repo into owner and name, and a path into directory and file', () => {
    expect(splitLast('acme/retry-queue')).toEqual({ head: 'acme/', tail: 'retry-queue' });
    expect(splitLast('packages/reel/src/theme.ts')).toEqual({ head: 'packages/reel/src/', tail: 'theme.ts' });
  });
  it('leaves a name without a slash whole', () => {
    expect(splitLast('theme.ts')).toEqual({ head: '', tail: 'theme.ts' });
    expect(splitLast('dir/')).toEqual({ head: '', tail: 'dir/' });
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
