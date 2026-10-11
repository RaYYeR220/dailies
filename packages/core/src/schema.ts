import { z } from 'zod';

export const EntryKind = z.enum(['user', 'assistant', 'tool_call', 'tool_result']);
export const Entry = z.object({
  id: z.string(),                    // `${sessionId}:${index}`
  sessionId: z.string(),
  index: z.number().int().nonnegative(),
  ts: z.string().nullable(),
  kind: EntryKind,
  text: z.string(),                  // redacted; tool input as JSON for tool_call, output for tool_result
  toolName: z.string().optional(),
  toolUseId: z.string().optional(),
  command: z.string().optional(),    // shell tools only
  filePath: z.string().optional(),   // file-editing tools only
  isError: z.boolean().optional(),   // tool_result only
});
export type Entry = z.infer<typeof Entry>;

export const Session = z.object({
  id: z.string(),
  checkpointIds: z.array(z.string()),
  agent: z.string(),
  model: z.string().nullable(),
  branch: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  turnCount: z.number().int(),
  tokens: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number() }),
  commits: z.array(z.string()),
  filesTouched: z.array(z.string()),
  entries: z.array(Entry),
});
export type Session = z.infer<typeof Session>;

export const EvidenceRef = z.discriminatedUnion('type', [
  z.object({ type: z.literal('entry'), entryId: z.string(), quote: z.string().optional() }),
  z.object({ type: z.literal('diff'), sha: z.string(), path: z.string(), quote: z.string().optional() }),
  z.object({ type: z.literal('stat'), key: z.string() }),
]);
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const ClaimKind = z.enum(['tests_pass', 'build_passes', 'ran_command', 'fixed_error', 'implemented']);
export const Verdict = z.enum(['verified', 'contradicted', 'stale', 'unverifiable']);
export const Claim = z.object({
  id: z.string(),
  sessionId: z.string(),
  entryId: z.string(),               // the assistant entry holding the quote
  quote: z.string().min(1),          // literal text from that entry
  kind: ClaimKind,
  subject: z.string().optional(),    // command, error text or feature the claim is about
  verdict: Verdict.optional(),
  reason: z.string().optional(),
  evidence: z.array(EvidenceRef).default([]),
});
export type Claim = z.infer<typeof Claim>;

export const Beat = z.object({
  id: z.string(),
  kind: z.enum(['feature', 'fix', 'decision', 'failure', 'recovery']),
  title: z.string().max(80),
  summary: z.string().max(400),
  sessionIds: z.array(z.string()).min(1),
  entryRanges: z.array(z.object({ sessionId: z.string(), from: z.number().int(), to: z.number().int() })).min(1),
  commits: z.array(z.string()),
});
export type Beat = z.infer<typeof Beat>;

export const Line = z.object({
  id: z.string(),
  text: z.string().min(1).max(220),
  evidence: z.array(EvidenceRef).min(1),
});
export type Line = z.infer<typeof Line>;

const spoken = { id: z.string(), lines: z.array(Line).min(1) };
const silent = { id: z.string(), lines: z.array(Line).max(0).default([]) };

export const Scene = z.discriminatedUnion('type', [
  z.object({ ...silent, type: z.literal('title'), repo: z.string(), windowLabel: z.string(), sessionCount: z.number().int(), commitCount: z.number().int() }),
  z.object({ ...spoken, type: z.literal('prompt'), quote: z.string().max(280), sessionId: z.string(), entryId: z.string() }),
  z.object({ ...spoken, type: z.literal('terminal'), steps: z.array(z.object({ command: z.string().max(200), output: z.string().max(600), ok: z.boolean(), entryId: z.string() })).min(1).max(4) }),
  z.object({ ...spoken, type: z.literal('diff'), sha: z.string(), path: z.string(), hunk: z.string().max(2400), added: z.number().int(), removed: z.number().int() }),
  z.object({ ...spoken, type: z.literal('stats'), items: z.array(z.object({ label: z.string().max(24), value: z.string().max(16), statKey: z.string() })).min(1).max(6) }),
  z.object({ ...spoken, type: z.literal('flag'), claimId: z.string(), quote: z.string().max(240), verdict: z.enum(['contradicted', 'stale']), reality: z.string().max(200) }),
  z.object({ ...silent, type: z.literal('end'), repo: z.string(), verified: z.number().int(), flagged: z.number().int() }),
]);
export type Scene = z.infer<typeof Scene>;

export const Facts = z.record(z.string(), z.union([z.string(), z.number()]));
export type Facts = z.infer<typeof Facts>;

export const Storyboard = z.object({
  runId: z.string(),
  repo: z.string(),
  targetSec: z.number(),
  facts: Facts,
  scenes: z.array(Scene).min(2),     // first is title, last is end
});
export type Storyboard = z.infer<typeof Storyboard>;

export const LineTiming = z.object({ lineId: z.string(), startSec: z.number(), endSec: z.number() });
export type LineTiming = z.infer<typeof LineTiming>;

export const DiffIndex = z.record(z.string(), z.string());   // key `${sha}:${path}` -> patch text
export type DiffIndex = z.infer<typeof DiffIndex>;

export const IngestArtifact = z.object({
  repo: z.object({ url: z.string(), dir: z.string(), headSha: z.string() }),
  sessions: z.array(Session),
  diffs: DiffIndex,
  skipped: z.array(z.object({ ref: z.string(), reason: z.string() })),
  enrichments: z.record(z.string(), z.enum(['used', 'skipped'])),
  redactions: z.number().int(),
});
export type IngestArtifact = z.infer<typeof IngestArtifact>;

export const RenderArtifact = z.object({ videoPath: z.string(), srtPath: z.string(), posterPath: z.string(), durationSec: z.number() });
export type RenderArtifact = z.infer<typeof RenderArtifact>;

export const Finding = z.object({ sceneId: z.string().nullable(), issue: z.string(), severity: z.enum(['low', 'high']), fix: z.string() });
export type Finding = z.infer<typeof Finding>;
