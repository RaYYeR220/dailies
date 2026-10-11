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

const WRAP_FILL = 0.85;   // share of a wrapped block that holds glyphs; the rest is ragged line ends
const LINE_FILL = 0.92;   // margin for glyphs wider than the average advance

/** Largest font size, in whole pixels, at which `chars` characters wrap inside `box`. `advance` is the mean glyph width in em. */
export function fitSize(chars: number, box: { width: number; height: number }, type: { max: number; min: number; advance: number; leading: number }): number {
  for (let size = type.max; size > type.min; size--) {
    const cols = Math.floor(box.width / (size * type.advance));
    const rows = Math.floor(box.height / (size * type.leading));
    if (cols * rows * WRAP_FILL >= chars) return size;
  }
  return type.min;
}

/** Largest font size at which `chars` characters stay on one line of `width`. */
export function fitLine(chars: number, width: number, type: { max: number; min: number; advance: number }): number {
  const size = Math.floor((width * LINE_FILL) / (Math.max(1, chars) * type.advance));
  return Math.max(type.min, Math.min(type.max, size));
}
