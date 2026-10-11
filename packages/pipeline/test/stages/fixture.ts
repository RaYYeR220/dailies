import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostMeter, createMockClient, type ChatMessage, type ModelClient, type Role } from '@dailies/agent';
import { DEFAULT_BUDGET, type Beat, type Budget, type Claim, type Entry, type IngestArtifact, type Session } from '@dailies/core';
import type { TtsProvider } from '@dailies/voice';
import { createRun, getRun, openDb } from '../../src/index';
import type { Database, StageContext, StageName } from '../../src/index';
import type { ScriptArtifact, StageDeps } from '../../src/stages/index';
import { scriptStage } from '../../src/stages/script';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export const QUEUE_PATCH = `diff --git a/src/queue.ts b/src/queue.ts
index 1111111..2222222 100644
--- a/src/queue.ts
+++ b/src/queue.ts
@@ -41,5 +41,9 @@ export class Queue {
     try {
       await this.handler(job);
     } catch (err) {
-      this.failed.push(job);
+      if (job.attempts < this.maxAttempts) {
+        job.attempts += 1;
+        return this.run(job);
+      }
+      this.failed.push({ ...job, error: String(err) });
     }
   }`;

export const STATUS_PATCH = `diff --git a/src/status.ts b/src/status.ts
index 3333333..4444444 100644
--- a/src/status.ts
+++ b/src/status.ts
@@ -10,3 +10,4 @@ export function status(opts: Options) {
   const report = collect();
+  if (opts.json) return console.log(JSON.stringify(report));
   print(report);
 }`;

export const FAILED_RUN = ` FAIL  test/queue.test.ts > retries a failed job
AssertionError: expected 1 to be 3

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)`;

export const PASSED_RUN = ` ✓ test/status.test.ts (3 tests) 41ms

 Test Files  1 passed (1)
      Tests  3 passed (3)`;

type PartialEntry = Pick<Entry, 'kind'> & Partial<Omit<Entry, 'id' | 'sessionId' | 'index' | 'kind'>>;

export function session(id: string, entries: PartialEntry[], o: Partial<Session> = {}): Session {
  return {
    id,
    checkpointIds: [`cp_${id}`],
    agent: 'claude-code',
    model: 'claude-sonnet-4.6',
    branch: 'main',
    startedAt: '2026-10-10T07:00:00Z',
    endedAt: '2026-10-10T07:30:00Z',
    turnCount: entries.filter((e) => e.kind === 'user').length,
    tokens: { input: 1000, output: 400, cacheRead: 0, cacheWrite: 0 },
    commits: [],
    filesTouched: [],
    ...o,
    entries: entries.map((e, index) => ({ ts: null, text: '', ...e, id: `${id}:${index}`, sessionId: id, index })),
  };
}

/**
 * Two sessions. In s1 the agent says the tests pass straight after a failing run; s2 is honest:
 * it runs the tests, they pass, it says so, and a second turn runs the build.
 */
export function twoSessions(): IngestArtifact {
  const s1 = session(
    's1',
    [
      { kind: 'user', text: 'The queue drops jobs when the worker restarts. Add a retry with backoff.' },
      { kind: 'assistant', text: 'I will add a retry loop to the run method.' },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't1', filePath: 'src/queue.ts', text: '{"file_path":"src/queue.ts"}' },
      { kind: 'tool_result', toolUseId: 't1', text: 'ok' },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm vitest run test/queue.test.ts', text: '{"command":"pnpm vitest run test/queue.test.ts"}' },
      { kind: 'tool_result', toolUseId: 't2', text: FAILED_RUN, isError: true },
      { kind: 'assistant', text: 'The retry is in place in `src/queue.ts`. All tests pass and the build is green.' },
    ],
    { commits: [SHA_A], filesTouched: ['src/queue.ts'] },
  );
  const s2 = session(
    's2',
    [
      { kind: 'user', text: 'Add a --json flag to the status command.' },
      { kind: 'assistant', text: 'I will add the flag and run the tests.' },
      { kind: 'tool_call', toolName: 'Edit', toolUseId: 't1', filePath: 'src/status.ts', text: '{"file_path":"src/status.ts"}' },
      { kind: 'tool_result', toolUseId: 't1', text: 'ok' },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't2', command: 'pnpm vitest run test/status.test.ts', text: '{"command":"pnpm vitest run test/status.test.ts"}' },
      { kind: 'tool_result', toolUseId: 't2', text: PASSED_RUN },
      { kind: 'assistant', text: 'Added the --json flag to the status command. All 3 tests pass.' },
      { kind: 'user', text: 'Thanks. Does the build still work?' },
      { kind: 'tool_call', toolName: 'Bash', toolUseId: 't3', command: 'pnpm build', text: '{"command":"pnpm build"}' },
      { kind: 'tool_result', toolUseId: 't3', text: 'Done in 2.1s' },
      { kind: 'assistant', text: 'The build passes.' },
    ],
    { commits: [SHA_B], filesTouched: ['src/status.ts'], startedAt: '2026-10-10T09:00:00Z', endedAt: '2026-10-10T09:20:00Z' },
  );
  return {
    repo: { url: 'https://github.com/acme/retry-queue', dir: '/tmp/acme__retry-queue', headSha: SHA_B },
    sessions: [s1, s2],
    diffs: { [`${SHA_A}:src/queue.ts`]: QUEUE_PATCH, [`${SHA_B}:src/status.ts`]: STATUS_PATCH },
    skipped: [],
    enrichments: {},
    redactions: 0,
  };
}

/** One beat per session of `twoSessions`. */
export function twoBeats(): { beats: Beat[] } {
  return {
    beats: [
      { id: 'beat_1', kind: 'fix', title: 'Retry for failed jobs', summary: 'The agent added a retry loop to the queue and ran the queue tests.', sessionIds: ['s1'], entryRanges: [{ sessionId: 's1', from: 0, to: 6 }], commits: [SHA_A] },
      { id: 'beat_2', kind: 'feature', title: 'JSON output for status', summary: 'The agent added a --json flag to the status command.', sessionIds: ['s2'], entryRanges: [{ sessionId: 's2', from: 0, to: 10 }], commits: [SHA_B] },
    ],
  };
}

export const LIE: Claim = {
  id: 'c_1',
  sessionId: 's1',
  entryId: 's1:6',
  quote: 'All tests pass and the build is green.',
  kind: 'tests_pass',
  verdict: 'contradicted',
  reason: 'the last recorded run failed',
  evidence: [{ type: 'entry', entryId: 's1:4' }, { type: 'entry', entryId: 's1:5' }],
};

/** What the verify stage finds in `twoSessions`: the lie in s1, two verified claims in s2. */
export function threeClaims(): { claims: Claim[]; counts: Record<'verified' | 'contradicted' | 'stale' | 'unverifiable', number> } {
  return {
    claims: [
      LIE,
      { id: 'c_2', sessionId: 's2', entryId: 's2:6', quote: 'All 3 tests pass.', kind: 'tests_pass', verdict: 'verified', reason: 'the last recorded run passed with no edits after', evidence: [{ type: 'entry', entryId: 's2:4' }, { type: 'entry', entryId: 's2:5' }] },
      { id: 'c_3', sessionId: 's2', entryId: 's2:6', quote: 'Added the --json flag to the status command.', kind: 'implemented', subject: '--json flag', verdict: 'verified', reason: 'the diff contains the quoted change', evidence: [{ type: 'diff', sha: SHA_B, path: 'src/status.ts', quote: 'if (opts.json) return console.log(JSON.stringify(report));' }] },
    ],
    counts: { verified: 2, contradicted: 1, stale: 0, unverifiable: 0 },
  };
}

const entryRef = (entryId: string) => ({ type: 'entry' as const, entryId });

/** A writer reply that follows the arc over `twoSessions`: every pointer and every citation resolves. */
export function writerReply() {
  return {
    scenes: [
      { type: 'prompt', entryId: 's1:0', lines: [{ text: 'The session opened with a request to retry failed jobs.', evidence: [entryRef('s1:0')] }] },
      { type: 'diff', sha: SHA_A, path: 'src/queue.ts', lines: [{ text: 'The retry lives in the run method of the queue.', evidence: [{ type: 'diff', sha: SHA_A, path: 'src/queue.ts', quote: 'return this.run(job);' }] }] },
      { type: 'terminal', steps: [{ entryId: 's1:4' }], lines: [{ text: 'The queue test run failed on the retry count.', evidence: [entryRef('s1:5')] }] },
      { type: 'terminal', steps: [{ entryId: 's2:4' }, { entryId: 's2:8' }], lines: [{ text: 'In the second session all 3 tests passed.', evidence: [entryRef('s2:5')] }] },
      { type: 'stats', lines: [{ text: 'The window holds 2 sessions and 2 commits.', evidence: [{ type: 'stat', key: 'sessions.count' }, { type: 'stat', key: 'commits.count' }] }] },
    ],
  };
}

export const json = (value: unknown): ChatMessage => ({ role: 'assistant', content: JSON.stringify(value) });

/** The text of the system and user messages of a request, joined: what the model was told. */
export function promptText(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'system' || m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

export type MockRequest = { role: Role; messages: ChatMessage[] };

const dirs: string[] = [];

/** Removes every data directory a harness created. Call from `afterEach`. */
export function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * A run in an in-memory database, stage deps around a scripted model, and a stage context whose `read`
 * serves `artifacts` the way the store does: as parsed JSON, throwing when the stage has none.
 * Every model call adds `costPerCall` to the meter, as the router does with real spend.
 */
export function harness(o: {
  reply?: (req: MockRequest) => ChatMessage;
  artifacts?: Partial<Record<StageName, unknown>>;
  budget?: Budget;
  tts?: TtsProvider | null;
  costPerCall?: number;
  repoUrl?: string;
} = {}) {
  const budget = o.budget ?? DEFAULT_BUDGET;
  const db: Database = openDb(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'dailies-stages-'));
  dirs.push(dataDir);
  const runId = createRun(db, {
    repoUrl: o.repoUrl ?? 'https://github.com/acme/retry-queue',
    since: '2026-10-10T00:00:00Z',
    until: '2026-10-11T00:00:00Z',
    budget,
  });

  const meter = new CostMeter(budget.maxCostPerReelUsd);
  const calls: MockRequest[] = [];
  const mock = createMockClient((req) => {
    calls.push(req);
    if (!o.reply) throw new Error(`unexpected model call for role ${req.role}`);
    return o.reply(req);
  });
  const client: ModelClient = {
    async complete(req) {
      meter.add(o.costPerCall ?? 0);
      return mock.complete(req);
    },
  };

  const artifacts: Partial<Record<StageName, unknown>> = { ...o.artifacts };
  const events: string[] = [];
  const ctx = (feedback: string | null = null): StageContext => ({
    run: getRun(db, runId),
    dataDir,
    runDir: join(dataDir, 'runs', runId),
    read: <T>(stage: StageName): T => {
      if (!(stage in artifacts)) throw new Error(`artifact not found for stage ${stage}`);
      return JSON.parse(JSON.stringify(artifacts[stage])) as T;
    },
    log: (message) => events.push(message),
    feedback,
  });

  const deps: StageDeps = { db, client, meter, tts: o.tts ?? null, voice: 'Charon' };
  return { db, dataDir, runId, deps, meter, calls, artifacts, events, ctx };
}

/** The script stage's own artifact for `twoSessions`, so later stages are tested on what it really produces. */
export async function scriptArtifact(o: { reply?: unknown; claims?: Claim[]; ingest?: IngestArtifact } = {}): Promise<ScriptArtifact> {
  const verify = threeClaims();
  const h = harness({
    artifacts: { ingest: o.ingest ?? twoSessions(), edit: twoBeats(), verify: o.claims ? { ...verify, claims: o.claims } : verify },
    reply: () => json(o.reply ?? writerReply()),
  });
  return (await scriptStage(h.deps).run(h.ctx())).artifact;
}
