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
