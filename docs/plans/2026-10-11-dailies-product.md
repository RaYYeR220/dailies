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

Note: `buildStages` and `reviewStage` are produced by core Tasks 8 and 9, not by this task, and "Task order" above correctly marks Task 11 as independent of both. Until one of those lands in `@dailies/pipeline`, `worker-main.ts` cannot import either name and still type-check, so its `makeStages` is a placeholder that throws a clear message instead of wiring real stages; `workerLoop` itself (the part this task's tests cover) does not depend on them.

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

**Files:** `eval/**` (package `@dailies/eval`); also `pnpm-workspace.yaml` (add `eval`), root
`tsconfig.json` (add `eval/src/**/*.ts` and `eval/test/**/*.ts` to `include`) and root
`vitest.config.ts` (add `eval/test/**/*.test.ts` to `include`) — without these three, `tsc` and
`vitest` never look inside `eval/` at all, so `pnpm typecheck` and `pnpm --filter @dailies/eval
test` silently see nothing to check.

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

### Task 15: Container and deployment files

Depends on Task 11.

**Files:** `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `deploy/Caddyfile`, `deploy/README.md`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/server/heartbeat.ts`, `apps/web/test/health.test.ts`; in `apps/web/src/worker.ts` only the heartbeat call.

**Interfaces:**
- Consumes: the `start` and `worker` scripts of `@dailies/web`; `openDb`.
- Produces:
```ts
// apps/web/src/server/heartbeat.ts
export function beat(dataDir: string, now?: Date): void               // writes <dataDir>/worker.heartbeat (ISO time), atomically
export function heartbeatAgeSec(dataDir: string, now?: Date): number | null   // null when the file is absent
```
`GET /api/health` returns `200 { ok: true, db: true, workerAgeSec }` when the database opens and the heartbeat is younger than 60 s; `503` with the same shape and `ok: false` otherwise. `workerLoop` calls `beat` on every poll and after every stage event.

Container:

- **Image.** `node:24-bookworm-slim`. System packages: `git`, `ffmpeg`, `ca-certificates`, `fonts-liberation`, and the shared libraries Chrome Headless Shell needs on Debian (`libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2`). pnpm through corepack at the version in the lockfile. `pnpm install --frozen-lockfile`, then `pnpm --filter @dailies/web build`, then `npx remotion browser ensure` from `packages/reel` so the browser is baked into the image. Runs as a non-root user. `DAILIES_DATA_DIR=/data`.
- **Compose.** Three services from that one image and one named volume mounted at `/data`: `web` (`pnpm --filter @dailies/web start`, port 3000, healthcheck on `/api/health`), `worker` (`pnpm --filter @dailies/web worker`, `shm_size: 1gb` for the browser), `caddy` (`caddy:2`, ports 80 and 443, its own volumes for certificates). Secrets come from an `env_file: .env` on the host; the compose file contains none.
- **Caddy.** The site address is the environment variable `DAILIES_SITE_ADDRESS` (default `:80`). One `reverse_proxy web:3000` with `flush_interval -1` so server-sent events are not buffered.
- **`.dockerignore`.** `node_modules`, `.git`, `.env*`, `.dailies`, `**/.next`, `docs`.
- **`deploy/README.md`.** The exact commands to bring it up on a fresh Debian or Ubuntu host with Docker installed: clone, create `.env` from `.env.example`, `docker compose up -d --build`, check `/api/health`, read logs, update to a new commit. Nothing provider-specific.

- [ ] **Step 1: Write failing tests** for `beat` / `heartbeatAgeSec` (absent file, fresh, stale) and the health route (200 when fresh, 503 when stale or absent).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the heartbeat, the route and the worker call.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Write** the Dockerfile, compose file, Caddyfile, `.dockerignore` and `deploy/README.md`. Validate with `docker compose config`. If Docker is available, `docker build .` once and report the image size and build time; if the build is too slow to finish, say how far it got.
- [ ] **Step 6: Commit.**

---

### Task 16: Reel scenes in the Loupe direction

The neutral placeholder look of the renderer is replaced by the chosen visual direction, "Loupe": the night's work is a strip of film on a switched-off lightbox, and a loupe moves along it. What sits under the glass is what the narrator is talking about.

**Files:** `packages/reel/src/theme.ts`, `packages/reel/src/remotion/**`, `packages/reel/test/**`, `packages/core/src/schema.ts` (one optional field), `docs/design.md`

**Interfaces:**
- Consumes and produces: `buildTimeline`, `toSrt`, `renderReel`, `renderStills` keep their signatures and behaviour. `Storyboard` gains one optional field: the `end` scene accepts `unverified: z.number().int().default(0)`.

Visual language (binding):

- **Surface.** Green-black emulsion `#0d1211` to `#1a2421`; cool white `#eef3f1` for text; grease-pencil yellow `#ffd60a` for every mark. No other accent colour.
- **Type.** Unbounded for display, Figtree for text, Martian Mono for code, loaded through `@remotion/google-fonts`.
- **The film strip.** A horizontal strip with sprocket holes carries small frames; each scene's content lives on frames of that strip. The strip drifts slowly while a scene plays.
- **The loupe.** One lens (glass, knurled rim, a soft highlight, the engraved rim text) is drawn by a single component. It is a persistent layer of the composition, not part of any scene: each scene declares where the lens rests and how large it is, and between scenes the lens glides from one resting place to the next with a spring. Content under the glass is shown enlarged.
- **Pencil grammar.** A hand-drawn closed ring means verified. A hand-drawn cross means contradicted. A dashed ring means stale. A pencil question mark means unverified. Marks draw on (stroke animation) when their line is spoken. The same four marks are used everywhere and nothing else carries those meanings.
- **Scenes.**
  - `title`: the lens rests on the repo name; the window label is set large beside it.
  - `prompt`: the human's request seen through the glass, labelled `You asked`, with its session reference.
  - `terminal`: one film frame per step with the command and the decisive part of the output set large (`2 failed`, `14 passed`); the lens rests on the last step; a passing step is ringed, a failing step is crossed.
  - `diff`: the patch through the glass with file name and the added and removed counts; added and removed lines keep a restrained tint.
  - `stats`: one frame per value; the lens rests on the first.
  - `flag`: the agent's quote on a frame with the cross drawn through it; beside it the lens over the recorded reality with a ring; a yellow pill with the verdict; the source reference under the frame. For a `stale` verdict the mark over the quote is the dashed ring and the pill reads `STALE`.
  - `end`: the repo name, and a strip of small frames with one mark per claim: rings for `verified`, crosses for `flagged`, question marks for `unverified`, in that order, capped at 16 marks with a `+n` after them; below it the three counts in words.
- **Captions.** In a captions-only cut the current line is shown in a bar at the bottom; in a voiced cut there is no bar.
- **Legibility floor.** Display text is at least 72 px, body at least 40 px, code at least 30 px at 1920x1080. Text never touches the lens rim. A line too long for its frame is shortened with an ellipsis by the existing text helpers, never shrunk below the floor.

Reference mock-ups of all seven frames exist as static HTML outside the repository (path given in the task prompt). They are the visual target. Reproduce their composition with Remotion components; do not copy their HTML wholesale, and do not import anything from that directory.

- [ ] **Step 1: Read the reference frames and the current renderer.** Write `docs/design.md`: the colour, type and spacing tokens, the pencil grammar, and one paragraph per scene. This file is the product's design reference from now on.
- [ ] **Step 2: Write failing tests:** the theme exposes the tokens above; the `end` scene accepts `unverified` and defaults it to 0; a pure `lensPath(timeline, storyboard)` function returns one resting place per scene and interpolates between two consecutive ones at the midpoint of the transition; a pure `endMarks({ verified, flagged, unverified })` returns the marks in order and caps at 16 with the overflow count.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** the theme, the film strip, the lens layer, the pencil marks, and the seven scenes.
- [ ] **Step 5: Run the unit tests and the existing render tests.** Expected: PASS.
- [ ] **Step 6: Render stills** of the fixture storyboard and of the stress storyboard, open every one, and compare with the reference frames. Fix overflow, collisions with the lens rim and anything weaker than the reference. Repeat until they hold up. Then render the full fixture reel once and step through it for the lens glide and the mark animations.
- [ ] **Step 7: Commit.**

---

### Task 14: Web interface

Depends on Task 11. Visual direction: "Loupe", the same language as the reel (Task 16): green-black emulsion `#0d1211` to `#1a2421`, cool white `#eef3f1`, grease-pencil yellow `#ffd60a`; Unbounded, Figtree, Martian Mono; a film strip, one loupe, and four pencil marks (ring = verified, cross = contradicted, dashed ring = stale, question mark = unverified).

**Files:** `apps/web/src/app/**` except `api/**` and `media/**`, `apps/web/src/ui/**`, `apps/web/public/**`, `apps/web/test/ui/**`

**Interfaces:**
- Consumes: only the HTTP API of Task 11 (`/api/runs`, `/api/runs/[id]`, `/api/runs/[id]/events`, `/api/reels/[id]`, `/api/reels`, `/api/reels/[id]/approve`, `/api/reels/[id]/feedback`, `/media/[id]/[file]`). No direct database or filesystem access from pages or components.
- Produces: the pages below, and these pure helpers with tests:
```ts
// apps/web/src/ui/model.ts
export type Mark = 'ring' | 'cross' | 'dashed' | 'question';
export function markFor(verdict: 'verified' | 'contradicted' | 'stale' | 'unverifiable'): Mark
export function stageStates(stages: { name: string; status: string }[]): { name: string; state: 'done' | 'running' | 'waiting' | 'failed' }[]   // always the nine stages, in pipeline order
export function lineAt(timings: { lineId: string; startSec: number; endSec: number }[], t: number, audioOffsetSec: number): string | null
export function evidenceHref(ref: EvidenceRef, repoUrl: string): string | null   // GitHub commit URL for a diff ref, null for entry and stat refs
export function formatCost(usd: number, budgetUsd: number): string               // "$0.31 of $0.60"
```

Pages:

| Route | Content |
|---|---|
| `/` | Landing. Hero with the claim `Your agents worked all night. Watch the cut.`, the sub line, and a repository input with the button `Paste a repo` that posts to `/api/runs` and navigates to the run page; a 429 or 400 is shown inline in words. Then: a sample reel player (the video of the run named by `NEXT_PUBLIC_FEATURED_RUN` when set, otherwise the section is omitted); how it reads the night, in three steps drawn as frames on a strip, not as cards; one narration line with its evidence opened; the four verdicts with their marks; the command `entire dailies run .`; a footer with the repository link and the line `Verification rests on what the session recorded.` |
| `/r/[id]` | A run in progress. The nine stages as frames on a strip with done, running, waiting and failed states; the live event log fed by the event stream, reconnecting with `Last-Event-ID`; cost so far against the budget; the gate's four checks as empty mark sockets that fill when the gate stage reports. When the run reaches `needs_approval` a link to the reel page appears; `blocked` and `failed` show the reason in words. |
| `/reel/[id]` | The player (HTML video with the subtitles track and the poster), and the evidence panel: every narration line with its time, the current one highlighted while the video plays, each line opening to its sources (the quoted transcript entry, or the patch with a link to the commit on GitHub); the flags with their marks and the recorded reality; duration, cost against budget and the run id. Two buttons, `Approve` and `Request changes` (a text box); both ask once for the owner token and keep it in session storage. |
| `/gallery` | Approved reels, newest first: poster, repository, date. Empty state in words. |

Rules:

- Server components fetch through the API with `fetch`; the event stream and the player are client components. No UI library, no CSS framework: one global stylesheet with the tokens as custom properties, and CSS modules per component.
- The loupe on the web is how something opens: on the landing it sits over the evidence example, on the reel page the open narration line is "under the glass". It is drawn in SVG by one component.
- Every page works at 390 px wide without horizontal scroll and is usable by keyboard; marks have text alternatives; motion respects `prefers-reduced-motion`.
- No table above the fold on the landing. No three-card feature row. No icons in rounded squares.

Reference mock-ups of the landing, the reel page and the run page exist as static HTML outside the repository (path given in the task prompt). They are the visual target; rebuild them as components on real data, and do not import anything from that directory.

- [ ] **Step 1: Write failing tests** for the five helpers in `model.ts` with concrete values (all four verdicts; a run with three done stages, one running and five waiting; a time before the first line, inside a line and after the last; a diff ref, an entry ref; the cost string).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, the tokens, the loupe, the strip and the marks, then the four pages.
- [ ] **Step 4: Run the tests, `pnpm typecheck` and `pnpm --filter @dailies/web build`.** Expected: PASS.
- [ ] **Step 5: Look at it.** Start the app against a temp data directory seeded with one finished run's artifacts (write a small seed script under `apps/web/test/ui/seed.ts` that creates the rows and artifact files from fixtures), open each page at 1440 and 390 wide, screenshot, compare with the reference mock-ups, and fix what is weaker. Repeat until the pages hold up.
- [ ] **Step 6: Commit.**

---

### Task 12b: Mutation benchmark, second version

The first run of the benchmark on real sessions reported a flip rate of 0.693 over 202 cases. The session that built it traced the misses to the harness, not the verifier: a case was created for every recognised run, but the verifier rests a claim on the last run of that class before the claim. In real sessions several runs often precede one assistant message, so mutating an earlier run cannot change the verdict. The benchmark was measuring its own anchoring.

The first result stays in the repository as it is. This task adds a second version beside it and reports both.

**Files:** `eval/**`

**Interfaces:**
- `runMutationBenchmark` keeps its signature and now returns, in addition, `version: 2`, `eligible`, `ineligible` and `ineligibleReasons: Record<string, number>`.
- New: `export function isEvidencingRun(session: Session, run: ToolRun, claim: Claim): boolean` — true only when `run` is the last run of its class before the claim's entry.

Behaviour:

- A run yields a case only if it is the evidencing run of its synthetic claim. Runs that are not are counted under `ineligible` with the reason `not the last run before the next message`. The other existing skip reasons (no following assistant entry, a source edit in between) are counted there too.
- `flipRate` is computed over eligible cases only. Any eligible case that does not flip is a verifier defect: list it, and if it reproduces in a unit test, fix `packages/verify` in this branch with that test.
- The scorecard opens with a summary table (version 1 and version 2 side by side: runs seen, recognised, unknown, recognition rate, cases, flipped, flip rate), then one paragraph that says in plain words why version 1 under-reported, then the ineligible reasons with counts, then only the eligible cases that did not flip.
- Results are written as `<date>-mutation-v2.json` and `<date>-scorecard.md`; the version 1 files from the first run are not modified or deleted. The scorecard links to them.
- Add `https://github.com/HighnessAtharva/firstrun` (`maxSessions: 12`) to the dataset, so the numbers rest on more than one repository.

- [ ] **Step 1: Write failing tests:** `isEvidencingRun` for a cluster of three runs before one message (only the third is true); a session with such a cluster yields one case and two ineligible; an eligible passing run flips to contradicted and back; the scorecard contains both versions' numbers and no repository URL.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Run the benchmark** on the dataset and commit the results exactly as produced.
- [ ] **Step 6: Commit.**
