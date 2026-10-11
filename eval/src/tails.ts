import type { Session } from '@dailies/core';
import { redact } from '@dailies/core';
import { collectRuns } from '@dailies/verify';

const TAIL_LENGTH = 200;
// Larger than any realistic single secret match, so a secret sitting right at the 200-character
// cut is still fully visible to redact() before that cut is made (mirrors @dailies/ingest's
// redactBounded pattern: redact a bounded window, then truncate — never the other way round).
const SAFETY_MARGIN = 8192;

// redact()'s private_key rule needs a literal "-----END ... PRIVATE KEY-----"; the safety-margin
// window can still cut that marker off. Catch an unterminated BEGIN and redact to the window's end.
const UNTERMINATED_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z ]*PRIVATE KEY-----)[\s\S]*$/;

function redactBounded(text: string): string {
  const r = redact(text);
  if (!UNTERMINATED_PRIVATE_KEY_RE.test(r.text)) return r.text;
  return r.text.replace(UNTERMINATED_PRIVATE_KEY_RE, '[REDACTED:private_key]');
}

export interface TailCount {
  tail: string;
  count: number;
}

/** Ranks the most common unrecognised ('unknown') output tails so the parser can be improved from evidence. */
export function unrecognisedTails(sessions: Session[], limit = 10): TailCount[] {
  const counts = new Map<string, number>();

  for (const session of sessions) {
    for (const run of collectRuns(session)) {
      if (run.outcome !== 'unknown' || !run.resultEntryId) continue;
      const result = session.entries.find((e) => e.id === run.resultEntryId);
      if (!result) continue;
      const window = result.text.slice(-(TAIL_LENGTH + SAFETY_MARGIN));
      const tail = redactBounded(window).slice(-TAIL_LENGTH);
      counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tail, count]) => ({ tail, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
