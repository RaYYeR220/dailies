import type { DiffIndex, Entry, Facts, Line, Session } from '@dailies/core';
import { checkLine } from '@dailies/verify';

const STAT_KEYS = [
  'sessions.count',
  'commits.count',
  'files.count',
  'turns.total',
  'tools.calls',
  'tokens.output',
  'duration.minutes',
] as const;

function entry(index: number, kind: Entry['kind'], text: string): Entry {
  return { id: `fixture:${index}`, sessionId: 'fixture', index, ts: null, kind, text };
}

/** A fixed session, facts and patch that every fabricated/genuine line below is checked against. */
function buildFixture(): { session: Session; facts: Facts; diffs: DiffIndex } {
  const entries: Entry[] = [
    entry(0, 'user', 'Add retry logic to the fetch helper.'),
    entry(1, 'assistant', 'I added a retry loop that attempts the fetch up to 3 times before giving up.'),
    entry(2, 'tool_call', 'pnpm test'),
    entry(3, 'assistant', 'All 14 tests pass after the change.'),
  ];
  const session: Session = {
    id: 'fixture',
    checkpointIds: ['cp1'],
    agent: 'claude-code',
    model: 'claude-sonnet-4.6',
    branch: 'main',
    startedAt: '2026-10-01T00:00:00Z',
    endedAt: '2026-10-01T00:10:00Z',
    turnCount: entries.length,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    commits: ['abc123'],
    filesTouched: ['src/retry.ts'],
    entries,
  };
  const facts: Facts = {
    'sessions.count': 1,
    'commits.count': 2,
    'files.count': 4,
    'turns.total': 8,
    'tools.calls': 5,
    'tokens.output': 300,
    'duration.minutes': 12,
  };
  const diffs: DiffIndex = {
    'abc123:src/retry.ts': '+function retryFetch(url) {\n+  for (let i = 0; i < 3; i++) {\n+    return fetch(url);\n+  }\n+}',
  };
  return { session, facts, diffs };
}

const GENUINE_TEMPLATES: ((n: number) => string)[] = [
  (n) => `The run recorded ${n} in this metric.`,
  (n) => `This stage measured exactly ${n}.`,
  (n) => `The count for this stat is ${n}.`,
];

function buildGenuineLines(facts: Facts): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < 20; i += 1) {
    const key = STAT_KEYS[i % STAT_KEYS.length]!;
    const value = facts[key] as number;
    const text = GENUINE_TEMPLATES[i % GENUINE_TEMPLATES.length]!(value);
    lines.push({ id: `genuine-${i}`, text, evidence: [{ type: 'stat', key }] });
  }
  return lines;
}

// One builder per fabrication kind named in the task: wrong number, entry that does not exist,
// quote not in the entry, stat key that does not exist, banned phrase, two sentences.
function buildFabricatedLines(session: Session, facts: Facts): Line[] {
  const assistantId = session.entries.find((e) => e.kind === 'assistant')!.id;
  const builders: ((i: number) => Line)[] = [
    (i) => ({
      id: `fab-wrongnum-${i}`,
      text: `The run recorded ${(facts['commits.count'] as number) + 1} in this metric.`,
      evidence: [{ type: 'stat', key: 'commits.count' }],
    }),
    (i) => ({
      id: `fab-noentry-${i}`,
      text: 'The agent explained this step in detail.',
      evidence: [{ type: 'entry', entryId: `missing-${i}:0` }],
    }),
    (i) => ({
      id: `fab-badquote-${i}`,
      text: 'The agent explained this step in detail.',
      evidence: [{ type: 'entry', entryId: assistantId, quote: 'this exact phrase never appears' }],
    }),
    (i) => ({
      id: `fab-badstat-${i}`,
      text: 'The agent explained this step in detail.',
      evidence: [{ type: 'stat', key: `missing.stat.${i}` }],
    }),
    (i) => ({
      id: `fab-banned-${i}`,
      text: 'This is a robust fix.',
      evidence: [{ type: 'stat', key: 'commits.count' }],
    }),
    (i) => ({
      id: `fab-twosentence-${i}`,
      text: 'It works. It passes.',
      evidence: [{ type: 'stat', key: 'commits.count' }],
    }),
  ];
  const lines: Line[] = [];
  for (let i = 0; i < 20; i += 1) lines.push(builders[i % builders.length]!(i));
  return lines;
}

export function runGroundingBenchmark(): { fabricated: number; rejected: number; genuine: number; accepted: number } {
  const { session, facts, diffs } = buildFixture();
  const ctx = { sessions: [session], facts, diffs };
  const genuineLines = buildGenuineLines(facts);
  const fabricatedLines = buildFabricatedLines(session, facts);

  const rejected = fabricatedLines.filter((l) => !checkLine(l, ctx).ok).length;
  const accepted = genuineLines.filter((l) => checkLine(l, ctx).ok).length;

  return { fabricated: fabricatedLines.length, rejected, genuine: genuineLines.length, accepted };
}
