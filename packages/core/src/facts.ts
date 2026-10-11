import type { Session, Facts } from './schema';
export function computeFacts(sessions: Session[]): Facts {
  const commits = new Set(sessions.flatMap((s) => s.commits));
  const files = new Set(sessions.flatMap((s) => s.filesTouched));
  const calls = sessions.reduce((n, s) => n + s.entries.filter((e) => e.kind === 'tool_call').length, 0);
  const minutes = sessions.reduce((n, s) => n + (s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000 : 0), 0);
  return {
    'sessions.count': sessions.length,
    'commits.count': commits.size,
    'files.count': files.size,
    'turns.total': sessions.reduce((n, s) => n + s.turnCount, 0),
    'tools.calls': calls,
    'tokens.output': sessions.reduce((n, s) => n + s.tokens.output, 0),
    'duration.minutes': Math.round(minutes),
  };
}
