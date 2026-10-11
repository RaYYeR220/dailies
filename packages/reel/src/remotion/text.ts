// Pure text shaping for the scenes: no React, no theme, so it runs under vitest.

/** The limits `Scene` in `@dailies/core` already enforces. Scenes clamp to them again because render props arrive unparsed. */
export const LIMITS = {
  promptQuote: 280,
  command: 200,
  output: 600,
  hunk: 2400,
  statLabel: 24,
  statValue: 16,
  flagQuote: 240,
  flagReality: 200,
  line: 220,
} as const;

const ELLIPSIS = '…';

/** Cut to `max` characters, ellipsis included. Counts code points so an emoji is never split. */
export function clampEnd(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + ELLIPSIS;
}

/** Like `clampEnd` but keeps the tail, which is the part of a path worth reading. */
export function clampStart(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return ELLIPSIS + chars.slice(chars.length - Math.max(0, max - 1)).join('').trimStart();
}

const monoLine = (line: string) => line.replace(/\r/g, '').replace(/\t/g, '  ').trimEnd();

/**
 * The last non-blank lines of a command's output, since that is where a runner prints its verdict.
 * When lines are left out, one of the `maxLines` rows is kept free for a marker showing `skipped`.
 */
export function tailLines(output: string, maxLines: number, maxCols: number): { skipped: number; lines: string[] } {
  const all = output.split('\n').map(monoLine).filter((l) => l.trim() !== '');
  const keep = all.length <= maxLines ? all.length : Math.max(0, maxLines - 1);
  return { skipped: all.length - keep, lines: all.slice(all.length - keep).map((l) => clampEnd(l, maxCols)) };
}

export interface DiffRow { kind: 'add' | 'del' | 'context' | 'hunk'; text: string }

/** Rows of a unified diff without their marker column. Anything in front of the first `@@` is file header and is dropped. */
export function parseHunk(hunk: string): DiffRow[] {
  const lines = hunk.replace(/\n+$/, '').split('\n').map(monoLine);
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
  const rows: DiffRow[] = [];
  for (const line of firstHunk > 0 ? lines.slice(firstHunk) : lines) {
    if (line.startsWith('\\')) continue;                        // "\ No newline at end of file"
    if (line.startsWith('@@')) rows.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1) });
    else rows.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line });
  }
  return rows;
}

/**
 * At most `max` rows of a patch. A patch that does not fit is shown through the window holding the most
 * changed lines (the earliest on a tie), with one of the `max` rows kept free for a marker showing `hidden`.
 */
export function windowRows(rows: DiffRow[], max: number): { rows: DiffRow[]; hidden: number } {
  if (rows.length <= max) return { rows, hidden: 0 };
  const size = Math.max(0, max - 1);
  const changed = (r: DiffRow) => (r.kind === 'add' || r.kind === 'del' ? 1 : 0);
  let best = 0;
  let bestCount = -1;
  for (let start = 0; start + size <= rows.length; start++) {
    const count = rows.slice(start, start + size).reduce((n, r) => n + changed(r), 0);
    if (count > bestCount) { best = start; bestCount = count; }
  }
  return { rows: rows.slice(best, best + size), hidden: rows.length - size };
}

/**
 * A value counting up from zero. `progress` runs 0..1; at 1 the original string is returned untouched,
 * so what stays on screen is exactly the value the storyboard carries.
 */
export function countUp(value: string, progress: number): string {
  if (progress >= 1) return value;
  const m = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(value);
  if (!m) return value;
  const [, prefix, digits, suffix] = m as unknown as [string, string, string, string];
  const decimals = digits.includes('.') ? digits.length - digits.indexOf('.') - 1 : 0;
  const current = (Number(digits.replace(/,/g, '')) * Math.max(0, progress)).toFixed(decimals);
  const [whole, fraction] = current.split('.') as [string, string | undefined];
  const grouped = digits.includes(',') ? whole.replace(/\B(?=(\d{3})+$)/g, ',') : whole;
  return prefix + grouped + (fraction === undefined ? '' : `.${fraction}`) + suffix;
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|\p{Extended_Pictographic}/u;
const NARROW = /[\p{Ll}\p{N}\p{P}\p{Z}]/u;

/**
 * The width of `text` counted in average lowercase Latin glyphs, for `fitSize` and `fitLine`.
 * Capitals and other scripts set broader than that average, full-width glyphs and emoji broader still;
 * counting characters alone would let a Cyrillic or CJK quote overflow its box.
 */
export function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += WIDE.test(ch) ? 2.4 : ch.charCodeAt(0) < 0x250 && NARROW.test(ch) ? 1 : 1.3;
  return units;
}

/**
 * The width of a string in em, in the face it will be set in. In the browser this is a measurement (measure.ts);
 * where there is nothing to measure with it is an estimate from `textUnits`.
 */
export type Em = (text: string) => number;

/** An estimate of `Em` for a face whose average lowercase glyph is `advance` em wide. */
export const estimateEm = (advance: number): Em => (text) => textUnits(text) * advance;

/** Text set in lines: the size it fits at, and whether the end had to be cut off with an ellipsis. */
export interface Fitted { size: number; lines: string[]; cut: boolean }

/** Characters a line may break after, besides a space. Prose breaks after a hyphen or a slash; a name or a path also after `_` and `.`. */
export const BREAKS = { prose: /[-/]/, name: /[-/_.]/ } as const;

interface Atom { text: string; width: number; space: boolean }   // `space`: a space comes before it when it does not start a line

function atoms(text: string, em: Em, soft: RegExp): Atom[] {
  const out: Atom[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let piece = '';
    let first = true;
    const push = () => { if (piece) out.push({ text: piece, width: em(piece), space: first && out.length > 0 }); first = false; piece = ''; };
    for (const ch of word) {
      piece += ch;
      if (soft.test(ch)) push();
    }
    push();
  }
  return out;
}

/** `split` comes back true when a word was too long for a line and had to be broken inside. */
function wrapAtoms(list: Atom[], width: (line: number) => number, em: Em, space: number, split: { any: boolean } = { any: false }): string[] {
  const lines: string[] = [];
  let line = '';
  let used = 0;
  const flush = () => { lines.push(line); line = ''; used = 0; };
  for (const atom of list) {
    const gap = line && atom.space ? space : 0;
    if (line && used + gap + atom.width > width(lines.length)) flush();
    if (!line && atom.width > width(lines.length)) {
      // A single word wider than the line: break it wherever the line ends.
      split.any = true;
      let rest = Array.from(atom.text);
      while (rest.length > 0) {
        let take = rest.length;
        while (take > 1 && em(rest.slice(0, take).join('')) > width(lines.length)) take--;
        line = rest.slice(0, take).join('');
        used = em(line);
        rest = rest.slice(take);
        if (rest.length > 0) flush();
      }
      continue;
    }
    line += (line && atom.space ? ' ' : '') + atom.text;
    used += (used > 0 ? gap : 0) + atom.width;
  }
  if (line) lines.push(line);
  return lines;
}

/** `text` broken into lines, line `i` at most `width(i)` em wide. A word too long for a line is split. */
export function wrap(text: string, width: (line: number) => number, em: Em, soft: RegExp = BREAKS.prose): string[] {
  return wrapAtoms(atoms(text, em, soft), width, em, em('n n') - em('nn'));
}

/** `line` shortened until it and an ellipsis fit in `width` em. */
export function cutToWidth(line: string, width: number, em: Em): string {
  const chars = Array.from(line.trimEnd());
  while (chars.length > 0 && em(chars.join('').trimEnd() + ELLIPSIS) > width) chars.pop();
  return chars.join('').trimEnd() + ELLIPSIS;
}

/** `line` as it is when it fits in `width` em, otherwise shortened to fit with an ellipsis. */
export function clampWidth(line: string, width: number, em: Em): string {
  return em(line) <= width ? line : cutToWidth(line, width, em);
}

const FIT_STEP = 2;
const KERN_ROOM = 0.985;   // lines are measured word by word; this leaves room for what kerning adds between them

/**
 * The largest size from `type.max` down to `type.min` at which `text` fits its room, and the lines it breaks into.
 * `room(count, lineHeight)` gives the widths in px open to `count` lines of that height, or null when that many
 * lines do not fit at all, so a room can be a box or the chords of a circle. Lines are evened out, not left ragged.
 * A word is never broken inside while a smaller size would keep it whole. With `fewest` the text takes as few
 * lines as it can before it takes a larger size: right for a name or a label, where a break costs more than size.
 * Text that does not fit even at `type.min` is cut with an ellipsis; it is never set smaller.
 */
export function fitText(
  text: string,
  type: { max: number; min: number; leading: number },
  room: (count: number, lineHeight: number) => number[] | null,
  em: Em,
  opts: { maxLines?: number; soft?: RegExp; fewest?: boolean } = {},
): Fitted {
  const maxLines = opts.maxLines ?? 12;
  const list = atoms(text, em, opts.soft ?? BREAKS.prose);
  const space = em('n n') - em('nn');
  if (list.length === 0) return { size: type.max, lines: [], cut: false };

  const sizes: number[] = [];
  for (let size = type.max; size > type.min; size -= FIT_STEP) sizes.push(size);
  sizes.push(type.min);

  const attempt = (size: number, count: number): Fitted | 'full' | null => {
    const widths = room(count, size * type.leading);
    if (!widths) return 'full';
    const at = (scale: number) => (i: number) => ((widths[Math.min(i, widths.length - 1)]! * KERN_ROOM) / size) * scale;
    const split = { any: false };
    const lines = wrapAtoms(list, at(1), em, space, split);
    if (lines.length > count || split.any) return null;
    // Even the lines out: the narrowest widths that still take the text in as many lines.
    let [lo, hi] = [0.4, 1];
    let best = lines;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      const tried = { any: false };
      const tighter = wrapAtoms(list, at(mid), em, space, tried);
      if (tighter.length <= lines.length && !tried.any) { best = tighter; hi = mid; } else lo = mid;
    }
    return { size, lines: best, cut: false };
  };

  if (opts.fewest) {
    for (let count = 1; count <= maxLines; count++) {
      for (const size of sizes) {
        const fitted = attempt(size, count);
        if (fitted && fitted !== 'full') return fitted;
      }
    }
  } else {
    for (const size of sizes) {
      for (let count = 1; count <= maxLines; count++) {
        const fitted = attempt(size, count);
        if (fitted === 'full') break;
        if (fitted) return fitted;
      }
    }
  }

  const size = type.min;
  let count = 0;
  while (count < maxLines && room(count + 1, size * type.leading)) count++;
  if (count === 0) return { size, lines: [], cut: true };
  const widths = room(count, size * type.leading)!;
  const width = (i: number) => (widths[Math.min(i, widths.length - 1)]! * KERN_ROOM) / size;
  const lines = wrapAtoms(list, width, em, space);
  if (lines.length <= count) return { size, lines, cut: false };
  const kept = lines.slice(0, count);
  kept[count - 1] = cutToWidth(kept[count - 1]!, width(count - 1), em);
  return { size, lines: kept, cut: true };
}

/** A room for `fitText` that is a plain box. */
export const boxRoom = (width: number, height: number) => (count: number, lineHeight: number): number[] | null =>
  count * lineHeight <= height ? Array<number>(count).fill(width) : null;

/** The decisive part of a command's output, for setting large, and the rest of its result. */
export interface Decisive { kind: 'count' | 'line' | 'status'; headline: string; detail: string | null }

const COUNTED = /(\d[\d,]*)\s+(failed|failing|failures?|errors?|problems?|passed|passing|skipped|pending|todo|warnings?|tests?)\b/gi;
const BAD = /^(failed|failing|failures?|errors?|problems?)$/;
const GOOD = /^(passed|passing)$/;

/**
 * What a command's output comes down to. A test runner's summary gives a count (`2 failed`, with `12 passed` as the
 * rest); the last such line wins, since that is where a runner prints its totals. Output with no count gives its last
 * line. `ok` is the step's own verdict and decides which count leads; it is also all there is when the output is empty.
 */
export function decisive(output: string, ok: boolean): Decisive {
  const lines = output.split('\n').map(monoLine).map((l) => l.trim()).filter(Boolean);
  const pairsOf = (line: string) =>
    [...line.matchAll(COUNTED)].map((m) => ({ count: m[1]!, word: m[2]!.toLowerCase() })).filter((p) => Number(p.count.replace(/,/g, '')) > 0);
  const summary = (test: (word: string) => boolean) => {
    for (const line of [...lines].reverse()) {
      const pairs = pairsOf(line);
      if (pairs.some((p) => test(p.word))) return pairs;
    }
    return null;
  };
  const pairs = summary((w) => BAD.test(w) || GOOD.test(w)) ?? summary(() => true);
  if (pairs) {
    const lead = pairs.find((p) => (ok ? GOOD : BAD).test(p.word)) ?? pairs[0]!;
    const rest = pairs.filter((p) => p !== lead && p.word !== lead.word).slice(0, 2);
    return { kind: 'count', headline: `${lead.count} ${lead.word}`, detail: rest.length > 0 ? rest.map((p) => `${p.count} ${p.word}`).join(', ') : null };
  }
  const last = lines.at(-1);
  if (last) return { kind: 'line', headline: last.replace(/\s+/g, ' '), detail: null };
  return { kind: 'status', headline: ok ? 'ok' : 'failed', detail: null };
}

const SESSION_CHARS = 9;
const REF_CHARS = 28;

/**
 * An entry id (`<session>:<index>`) as the reference printed under a frame; `short` leaves out the word
 * `session`, for where there is little room. An id of another shape is shown as it is.
 */
export function sourceRef(entryId: string, short = false): string {
  const cut = entryId.lastIndexOf(':');
  const index = entryId.slice(cut + 1);
  if (cut <= 0 || !/^\d+$/.test(index)) return clampEnd(entryId, REF_CHARS);
  return `${short ? '' : 'session '}${clampEnd(entryId.slice(0, cut), SESSION_CHARS)} · entry ${index}`;
}

/** The whitespace every one of `lines` starts with, counted in characters; blank lines do not count. */
export function commonIndent(lines: string[]): number {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length);
  return indents.length > 0 ? Math.min(...indents) : 0;
}

/** `text` split after its last `/`: an owner and a repo name, or a directory and a file name. */
export function splitLast(text: string): { head: string; tail: string } {
  const cut = text.lastIndexOf('/', text.length - 2);
  return { head: text.slice(0, cut + 1), tail: text.slice(cut + 1) };
}

/**
 * A sentence that ends on a count (`Last test run before this message: 2 failed.`), split so the count can be set
 * large: what leads up to it, and the count with its closing punctuation. Null when the count is not what the
 * sentence ends on, since pulling words out of the middle of a sentence would change how it reads.
 */
export function closingCount(text: string): { lead: string; count: string } | null {
  const matches = [...text.matchAll(COUNTED)].filter((m) => BAD.test(m[2]!.toLowerCase()) || GOOD.test(m[2]!.toLowerCase()));
  const last = matches.at(-1);
  if (!last || last.index === undefined) return null;
  const tail = text.slice(last.index + last[0].length);
  const lead = text.slice(0, last.index).trim();
  if (!/^[\s.!)\]"'’”]*$/.test(tail) || lead.length === 0) return null;
  return { lead, count: (last[0] + tail).trim() };
}
