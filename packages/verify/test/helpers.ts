import type { Claim, Entry, Session } from '@dailies/core';

export type PartialEntry = {
  kind: Entry['kind'];
  text?: string;
  ts?: string | null;
  toolName?: string;
  toolUseId?: string;
  command?: string;
  filePath?: string;
  isError?: boolean;
};

export function session(entries: PartialEntry[], opts: { id?: string } = {}): Session {
  const id = opts.id ?? 's1';
  const fullEntries: Entry[] = entries.map((e, index) => ({
    id: `${id}:${index}`,
    sessionId: id,
    index,
    ts: e.ts ?? null,
    kind: e.kind,
    text: e.text ?? '',
    toolName: e.toolName,
    toolUseId: e.toolUseId,
    command: e.command,
    filePath: e.filePath,
    isError: e.isError,
  }));
  return {
    id,
    checkpointIds: ['cp1'],
    agent: 'claude-code',
    model: 'claude-sonnet-4.6',
    branch: 'main',
    startedAt: '2026-10-10T07:00:00Z',
    endedAt: '2026-10-10T07:30:00Z',
    turnCount: fullEntries.length,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    commits: [],
    filesTouched: [],
    entries: fullEntries,
  };
}

export function claim(partial: {
  id?: string;
  sessionId: string;
  entryId: string;
  quote: string;
  kind: Claim['kind'];
  subject?: string;
}): Claim {
  return {
    id: partial.id ?? 'c1',
    sessionId: partial.sessionId,
    entryId: partial.entryId,
    quote: partial.quote,
    kind: partial.kind,
    subject: partial.subject,
    evidence: [],
  };
}
