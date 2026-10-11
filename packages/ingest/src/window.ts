import type { Session } from '@dailies/core';

/** Merges sessions that share an id: keeps the longest transcript, unions checkpoint ids and commits. */
export function mergeSessions(sessions: Session[]): Session[] {
  const byId = new Map<string, Session>();

  for (const session of sessions) {
    const existing = byId.get(session.id);
    if (!existing) {
      byId.set(session.id, session);
      continue;
    }
    const longer = session.entries.length > existing.entries.length ? session : existing;
    byId.set(session.id, {
      ...longer,
      checkpointIds: Array.from(new Set([...existing.checkpointIds, ...session.checkpointIds])),
      commits: Array.from(new Set([...existing.commits, ...session.commits])),
    });
  }

  return Array.from(byId.values());
}

export interface SessionTimeHint {
  sessionId: string;
  createdAt: string;
}

/**
 * Approximates `selectWindow`'s window-and-cap decision from session metadata alone (`createdAt`),
 * before any transcript is read. Several hints sharing a session id (the same session appearing
 * in more than one checkpoint) count as one candidate, using the earliest and latest `createdAt`
 * among them as a stand-in for that session's true start and end. The exact window is re-applied
 * by `selectWindow` once the surviving sessions are actually parsed.
 */
export function selectCandidateSessionIds(hints: SessionTimeHint[], since: string, until: string, maxSessions: number): Set<string> {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  const byId = new Map<string, { min: number; max: number }>();
  for (const hint of hints) {
    const ms = Date.parse(hint.createdAt);
    const existing = byId.get(hint.sessionId);
    if (!existing) byId.set(hint.sessionId, { min: ms, max: ms });
    else {
      existing.min = Math.min(existing.min, ms);
      existing.max = Math.max(existing.max, ms);
    }
  }

  const inWindow = Array.from(byId.entries()).filter(([, r]) => r.min <= untilMs && r.max >= sinceMs);
  inWindow.sort((a, b) => b[1].max - a[1].max);

  return new Set(inWindow.slice(0, maxSessions).map(([id]) => id));
}

/** Keeps sessions inside [since, until], sorted newest-first, truncated to maxSessions, then returned chronologically. */
export function selectWindow(sessions: Session[], since: string, until: string, maxSessions: number): Session[] {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  const inWindow = sessions.filter((s) => {
    const startedMs = Date.parse(s.startedAt);
    const endedMs = Date.parse(s.endedAt ?? s.startedAt);
    return startedMs <= untilMs && endedMs >= sinceMs;
  });

  const newestFirst = [...inWindow].sort(
    (a, b) => Date.parse(b.endedAt ?? b.startedAt) - Date.parse(a.endedAt ?? a.startedAt),
  );

  return newestFirst.slice(0, maxSessions).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
