# Dailies Product Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the core pipeline behind a web API with a background worker, measure the verifier on real data, and let the agent read its own trace history at run time.

**Architecture:** `apps/web` is a Next.js app that only reads and writes SQLite rows and serves files. A separate worker process executes runs with the durable runner. `eval/` holds benchmarks that reuse `@dailies/ingest` and `@dailies/verify` unchanged. `@dailies/agent` gains a small client for the neatlogs MCP endpoint.

**Tech Stack:** Next.js (App Router, route handlers), better-sqlite3, the packages from the core plan, vitest.

**Spec:** `docs/specs/2026-10-11-dailies-design.md` (sections 5, 6, 7, 9). Builds on `docs/plans/2026-10-11-dailies-core.md`; its Global Constraints apply here unchanged.

## Global Constraints

- Everything in the core plan's Global Constraints.
- The web app never imports `@dailies/reel`, `@remotion/*`, `openai` or `neatlogs`. Rendering and model calls happen only in the worker.
- The worker runs one pipeline at a time.
- No API key is needed to run any test in this plan. Live checks are separate scripts that exit with a clear message when a key is missing.
- Evaluation results never name a repository. Repositories are identified by the first 8 hex characters of the SHA-256 of their URL.

## Review Focus

1. Two requests create runs for the same repository at once: both are accepted and executed one after the other; neither corrupts the other's artifacts. Pinned in Task 11.
2. A client disconnects from the event stream mid-run: the server stops polling for it and the run is unaffected. Pinned in Task 11.
3. A request asks for `/media/<run>/../../.env`: rejected with 400 before touching the filesystem. Pinned in Task 11.
4. A real test-runner output the parser has never seen: counted as `unknown` in the recognition rate, never as a pass. Pinned in Task 12.
5. The neatlogs endpoint is down or returns a non-JSON body: the run proceeds without history and records `memory: skipped`. Pinned in Task 13.

## Task order

Tasks 11, 12 and 13 are independent of each other and of core Tasks 8 and 9. Task 11 needs core Task 7 merged; Task 12 needs core Tasks 2 and 4; Task 13 needs core Task 3. Task 14 needs Task 11 and the chosen visual direction.

---

### Task 11: Web API and worker

**Files:**
- Create: `apps/web/**` (package `@dailies/web`)
- Modify: `packages/pipeline/src/runner.ts`, `packages/pipeline/src/index.ts`, `packages/pipeline/test/runner.test.ts` (add `recut` only)

**Interfaces:**
- Consumes: `openDb`, `createRun`, `getRun`, `listEvents`, `runPipeline`, `unfinishedRuns`, `Stage`, `RunRecord` (`@dailies/pipeline`); `loadEnv`, `DEFAULT_BUDGET` (`@dailies/core`).
- Produces:
```ts
// packages/pipeline/src/runner.ts
export function recut(db: Database, runId: string, feedback: string): void
// resets `script` and every later stage to pending, sets the run to `running`, stores the feedback so the
// next `script` stage receives it as ctx.feedback; throws if the run never completed `verify`.

// apps/web/src/server/store.ts
export interface ReelRow { runId: string; status: 'draft' | 'approved'; approvedAt: string | null }
export function ensureWebTables(db: Database): void
export function getReel(db: Database, runId: string): ReelRow | null
export function approveReel(db: Database, runId: string): void
export function addFeedback(db: Database, runId: string, text: string): void
export function listApproved(db: Database, limit: number): { runId: string; repoUrl: string; approvedAt: string }[]
export function allowRun(db: Database, ip: string, now: Date, limits: { perIpPerDay: number; globalPerDay: number }): { ok: boolean; reason?: string }

// apps/web/src/worker.ts
export async function workerLoop(o: { db: Database; dataDir: string; makeStages: () => Stage[]; pollMs?: number; signal?: AbortSignal }): Promise<void>
```

Routes (route handlers under `apps/web/src/app`):

| Method and path | Behaviour |
|---|---|
| `POST /api/runs` | Body `{ repoUrl, since? }`. Accepts only `https://github.com/<owner>/<repo>` (optional `.git`, no query). `since` is `<n>h`, `<n>d` or ISO; default `7d`. Calls `allowRun` with the client address (first `x-forwarded-for` entry) and limits from `DAILIES_RUNS_PER_IP` (default 3) and `DAILIES_RUNS_PER_DAY` (default 40). Creates the run with `DEFAULT_BUDGET`. Returns `201 { runId }`, `400` on a bad URL, `429` with the reason when limited. |
| `GET /api/runs/[id]` | `{ run, stages: [{ name, status, attempt, startedAt, endedAt, error }] }` or 404. |
| `GET /api/runs/[id]/events` | Server-sent events. Sends every event after `Last-Event-ID` (or the `after` query), then polls `listEvents` every second. Sends `event: done` when the run status is no longer `running`. Stops when the request is aborted. |
| `GET /api/reels/[id]` | For a run that completed `ground`: `{ run, reel, storyboard, claims, timings, voiceMode, gate, media: { video, subtitles, poster } }`, reading the stage artifacts from `<dataDir>/runs/<id>/`. Media URLs are present only when the files exist. 404 otherwise. |
| `GET /api/reels` | Approved reels, newest first, at most 50. |
| `POST /api/reels/[id]/approve` | Requires header `x-owner-token` equal to `DAILIES_OWNER_TOKEN` (constant-time compare; 401 otherwise; 503 when the variable is unset). Only a run with status `needs_approval` can be approved (409 otherwise). |
| `POST /api/reels/[id]/feedback` | Body `{ text }` (1 to 1000 characters). Stores it. With a valid owner token it also calls `recut`. Returns `{ recut: boolean }`. |
| `GET /media/[id]/[file]` | Serves `reel.mp4`, `reel.srt`, `poster.png` from `<dataDir>/runs/<id>/reel/`. `id` must match `^run_[0-9a-f]+$` and `file` must be one of the three names, otherwise 400. Supports `Range` requests for the video. An unapproved reel is served only with the owner token or to a request carrying the `?k=<runId>` it already knows (the run id is the capability). |

Tables added by `ensureWebTables`:
```sql
CREATE TABLE IF NOT EXISTS reels (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, approved_at TEXT);
CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts TEXT NOT NULL);
```

Worker: `workerLoop` takes the oldest id from `unfinishedRuns(db)`, runs `runPipeline` for it to completion, then looks again; when there is none it waits `pollMs` (default 2000). Errors from one run are logged and do not stop the loop. `apps/web/src/worker-main.ts` wires the real stages (`buildStages` plus `reviewStage` from `@dailies/pipeline`, a router, a meter, the Gemini provider when keys exist), initialises tracing, and handles `SIGTERM` by aborting the loop after the current stage.

Scripts in `apps/web/package.json`: `dev` (next dev), `build`, `start` (next start), `worker` (`tsx src/worker-main.ts`).

Next.js config: `transpilePackages` for the `@dailies/*` packages the app imports; `serverExternalPackages: ['better-sqlite3']`. The database path is `<dataDir>/dailies.db`.

- [ ] **Step 1: Scaffold `apps/web`** with the current stable Next.js, React and TypeScript, App Router, no Tailwind and no UI library. Add it to the workspace and install.
- [ ] **Step 2: Write failing tests** (`apps/web/test/*.test.ts`, calling the route handler functions directly with `Request` objects and a temp data directory):

```ts
it('POST /api/runs rejects non-GitHub and malformed URLs with 400');
it('POST /api/runs creates a run and returns 201 with its id');
it('POST /api/runs returns 429 after the per-address limit, and after the global limit');
it('GET /api/runs/[id] returns stages in pipeline order, 404 for an unknown id');
it('the event stream replays events after Last-Event-ID and ends with event: done');
it('the event stream stops polling when the request is aborted');
it('GET /api/reels/[id] assembles the artifacts and omits media URLs for missing files');
it('approve requires the owner token and a needs_approval run');
it('feedback with the owner token calls recut and the run is running again');
it('GET /media rejects path traversal and unknown file names with 400');
it('GET /media honours a Range header with 206 and Content-Range');
it('workerLoop runs two queued runs one after the other and survives a failing run');
it('recut resets script and later stages and passes the feedback to the script stage');   // in packages/pipeline/test
```
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** `recut`, `store.ts`, the route handlers, `worker.ts`, `worker-main.ts`.
- [ ] **Step 5: Run the tests and `pnpm typecheck`.** Expected: PASS. Then `pnpm --filter @dailies/web build` must succeed.
- [ ] **Step 6: Commit.**

---

### Task 12: Evaluation harness

**Files:** `eval/**` (package `@dailies/eval`, added to `pnpm-workspace.yaml` as `eval`)

**Interfaces:**
- Consumes: `ingest` (`@dailies/ingest`); `collectRuns`, `verifyClaim`, `parseOutcome`, `checkLine` (`@dailies/verify`); schemas from `@dailies/core`.
- Produces:
```ts
export interface MutationCase { repo: string; sessionId: string; command: string; original: 'pass' | 'fail'; verdictBefore: Verdict; verdictAfter: Verdict; flipped: boolean }
export function syntheticClaim(session: Session, run: ToolRun): Claim | null
export function mutateRun(session: Session, run: ToolRun, to: 'pass' | 'fail'): Session
export function runMutationBenchmark(sessions: { repo: string; session: Session }[]): { cases: MutationCase[]; recognised: number; unknown: number; flipRate: number }
export function runGroundingBenchmark(): { fabricated: number; rejected: number; genuine: number; accepted: number }
export function repoKey(url: string): string          // first 8 hex of sha256(url)
```

Behaviour:

- **Recognition rate.** For every test, build or type-check run found by `collectRuns` in the dataset, record whether `parseOutcome` returned `pass`, `fail` or `unknown`. `recognised / (recognised + unknown)` is reported with the ten most common unrecognised output tails (last 200 characters, redacted) so the parser can be improved from evidence.
- **Mutation benchmark.** For each run with outcome `pass` or `fail`: `syntheticClaim` builds a `tests_pass` (or `build_passes`) claim anchored to the first assistant entry after the run, with that entry's first 80 characters as the quote; it returns `null` when no such entry exists or when a source edit sits between them. `verdictBefore` must be `verified` for a pass and `contradicted` for a fail. `mutateRun` returns a copy of the session in which that run's result text is replaced by a canonical opposite (`Tests  3 failed | 11 passed` or `Tests  14 passed (14)`; for type-check `error TS2322: mutated` or an empty string) and `isError` is set to match. `verdictAfter` must be the opposite verdict. `flipRate` is the share of cases where both hold.
- **Grounding benchmark.** A fixed fixture: one session, facts and a patch; twenty fabricated lines (wrong number, entry that does not exist, quote not in the entry, stat key that does not exist, banned phrase, two sentences) and twenty genuine ones. `checkLine` must reject every fabricated line and accept every genuine one.
- **Dataset.** `eval/datasets/public.json` is a list of `{ url, maxSessions }`. `eval/src/cli.ts` (`pnpm --filter @dailies/eval eval`) ingests each into `.dailies/`, runs both benchmarks and writes `eval/results/<date>-mutation.json`, `<date>-grounding.json` and a `<date>-scorecard.md` with the totals, the recognition rate, and every case that did not flip, identified by `repoKey`. A repository that fails to ingest is listed under `skipped` with the reason; it does not stop the run.

- [ ] **Step 1: Write failing tests** with hand-built sessions:

```ts
it('syntheticClaim anchors to the next assistant entry and skips runs followed by a source edit');
it('mutateRun flips only the targeted run and leaves the original session untouched');
it('a passing run mutated to failing goes verified -> contradicted; a failing one goes contradicted -> verified');
it('an unrecognised output counts as unknown and produces no mutation case');
it('the grounding benchmark rejects 20 of 20 fabricated lines and accepts 20 of 20 genuine ones');
it('repoKey is stable and 8 hex characters');
it('the scorecard lists non-flipping cases by repoKey and never contains a repository URL');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** If the grounding fixture exposes a real gap in `checkLine`, fix `packages/verify` in the same branch with a test, and say so in the report.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Seed the dataset** with `https://github.com/entireio/cli` (`maxSessions: 20`) and run the CLI once. Commit the results as they are, including any case that did not flip.
- [ ] **Step 6: Commit.**

---

### Task 13: Run-time read-back from neatlogs

**Files:** `packages/agent/src/neatlogs-mcp.ts`, `packages/agent/src/index.ts` (export only), `packages/agent/test/neatlogs-mcp.test.ts`, `packages/pipeline/src/memory.ts`, `packages/pipeline/test/memory.test.ts`, `scripts/neatlogs-actuals.ts`

**Interfaces:**
- Consumes: `Env` (`@dailies/core`).
- Produces:
```ts
// @dailies/agent
export interface NeatlogsMcp {
  call<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T>
  searchTraces(a: { query: string; workflowName?: string; dateFrom?: string; limit?: number }): Promise<TraceSummary[]>
  traceContext(traceId: string): Promise<unknown>
  analytics(a: { from: string; to: string; workflowName?: string; view?: string }): Promise<unknown>
}
export interface TraceSummary { traceId: string; status: string; createdAt: string; durationMs: number; totalTokens: number; costUsd: number; erroredSpans: number; workflowName: string | null; inputPreview: string; outputPreview: string }
export function createNeatlogsMcp(o: { apiKey: string; url?: string; fetchImpl?: typeof fetch }): NeatlogsMcp
export class NeatlogsUnavailableError extends Error {}

// @dailies/pipeline
export interface RunMemory { status: 'used' | 'skipped'; reason?: string; previousRuns: number; notes: string[] }
export async function recallRepo(mcp: NeatlogsMcp | null, repoUrl: string): Promise<RunMemory>
```

Protocol facts, confirmed against the live endpoint:

- Endpoint `https://ingest.neatlogs.com/mcp`, JSON-RPC 2.0 over HTTP POST. Headers: `Authorization: Bearer <project key>`, `Content-Type: application/json`, `Accept: application/json, text/event-stream`.
- First request: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"dailies","version":"0.1.0"}}}`. The response carries an `Mcp-Session-Id` header that every later request must send. Then send the notification `{"jsonrpc":"2.0","method":"notifications/initialized"}`.
- A tool call is `{"jsonrpc":"2.0","id":n,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`. The response body is an event stream: take the `data:` line, parse it, and the tool's JSON result is the string at `result.content[0].text`.
- `search_traces` arguments used here: `query`, `workflow_name`, `date_from`, `limit`, `preview_chars`. Its result is `{ total, results: [{ trace_id, status, created_at, duration_ms, total_tokens, cost_usd, errored_span_count, workflow_name, input_preview, output_preview, ... }] }`. With no matches `results` may be absent.
- The service allows 60 requests per minute per key.

Behaviour:

- The client initialises lazily on the first call and reuses the session id. A 401, a 5xx, a network error, a body without a `data:` line or a JSON-RPC `error` raises `NeatlogsUnavailableError` with a short message. One retry on 5xx after 1 s.
- `recallRepo` searches traces of the last 14 days whose input mentions the repository URL (`query` is the URL, `limit` 10). It returns `previousRuns` and up to five notes, one per earlier run that had `errored_span_count > 0` or a non-success status, in the form `<date>: <status>, <n> failed spans, <output preview cut to 120 characters>`. `mcp === null` or any `NeatlogsUnavailableError` returns `{ status: 'skipped', reason, previousRuns: 0, notes: [] }`.
- `scripts/neatlogs-actuals.ts` calls `analytics` for the last 7 days with `workflowName: 'dailies-reel'` and view `kpis`, and writes the raw response plus `{ runs, costUsdTotal, costUsdPerRun }` to `business/actuals.json`. Without `NEATLOGS_API_KEY` it prints `NEATLOGS_API_KEY is not set` and exits 1.

The stages do not call `recallRepo` in this task. Wiring its notes into the editor and writer prompts happens when core Task 8 is merged; this task delivers the client and the function with tests.

- [ ] **Step 1: Write failing tests** with a stub `fetchImpl` that plays the handshake:

```ts
it('initialises once, sends the session id on later calls, and parses the event-stream body');
it('maps search_traces rows to TraceSummary and treats a missing results field as empty');
it('raises NeatlogsUnavailableError on 401, on a body without a data line, and on a JSON-RPC error');
it('retries once on 503 and then succeeds');
it('recallRepo returns notes only for earlier runs that failed, newest first, at most five');
it('recallRepo returns skipped with the reason when the client throws, and when it is null');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 14: Web interface

Depends on Task 11 and on the chosen visual direction. Its steps are written once that direction is fixed; the routes it renders are listed in spec section 7 and the data comes only from the Task 11 API.
