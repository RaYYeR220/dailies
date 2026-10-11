import type { Session } from '@dailies/core';
import { redact } from '@dailies/core';
import { collectRuns } from '@dailies/verify';

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
      const tail = redact(result.text.slice(-200)).text;
      counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tail, count]) => ({ tail, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
