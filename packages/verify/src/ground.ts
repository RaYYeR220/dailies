import type { DiffIndex, Facts, Line, Session } from '@dailies/core';
import { quoteMatches } from './quote';
import { lintStyle } from './style';

const NUMBER_RE = /\d+(?:\.\d+)?/g;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsNumber(haystack: string, n: string): boolean {
  return new RegExp(`(?<![\\d.])${escapeRegex(n)}(?![\\d.])`).test(haystack);
}

export function checkLine(
  line: Line,
  ctx: { sessions: Session[]; facts: Facts; diffs: DiffIndex },
  o: { skipStyle?: boolean } = {}
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const entryById = new Map<string, { text: string }>();
  for (const s of ctx.sessions) for (const e of s.entries) entryById.set(e.id, e);

  const numbersInText = line.text.match(NUMBER_RE) ?? [];
  const groundedNumbers = new Set<string>();

  for (const ref of line.evidence) {
    if (ref.type === 'entry') {
      const entry = entryById.get(ref.entryId);
      if (!entry) {
        reasons.push(`unknown entry: ${ref.entryId}`);
        continue;
      }
      if (ref.quote && !quoteMatches(ref.quote, entry.text)) {
        reasons.push(`quote not found in entry ${ref.entryId}`);
      }
      for (const n of numbersInText) if (containsNumber(entry.text, n)) groundedNumbers.add(n);
    } else if (ref.type === 'diff') {
      const key = `${ref.sha}:${ref.path}`;
      const patch = ctx.diffs[key];
      if (patch === undefined) {
        reasons.push(`unknown diff: ${key}`);
        continue;
      }
      if (ref.quote && !quoteMatches(ref.quote, patch)) {
        reasons.push(`quote not found in diff ${key}`);
      }
      for (const n of numbersInText) if (containsNumber(patch, n)) groundedNumbers.add(n);
    } else {
      if (!Object.hasOwn(ctx.facts, ref.key)) {
        reasons.push(`unknown stat: ${ref.key}`);
        continue;
      }
      const value = String(ctx.facts[ref.key]);
      for (const n of numbersInText) if (n === value) groundedNumbers.add(n);
    }
  }

  for (const n of numbersInText) {
    if (!groundedNumbers.has(n)) reasons.push(`number not grounded in evidence: ${n}`);
  }

  if (!o.skipStyle) reasons.push(...lintStyle(line.text));

  return { ok: reasons.length === 0, reasons };
}
