# Dailies Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a repository URL, produce a fact-checked, narrated MP4 reel of its recorded coding-agent sessions through a resumable pipeline and a CLI.

**Architecture:** A pnpm TypeScript monorepo. `packages/core` holds every shared schema; each other package exposes plain functions over those schemas. A durable runner executes stages in order and persists each stage's artifact so a run can resume.

**Tech Stack:** Node 22+, pnpm workspaces, TypeScript (strict, ESM), zod, vitest, OpenAI SDK against an OpenAI-compatible gateway, neatlogs SDK, Remotion 4, better-sqlite3, ffmpeg, git, Entire CLI.

**Spec:** `docs/specs/2026-10-11-dailies-design.md`

This plan covers Tier 1 of the spec. The web app, evaluation harness, runtime read-back and deployment are separate plans that build on the interfaces fixed here.

## Global Constraints

- Node `>=22`. TypeScript `strict: true`, `"type": "module"`, `moduleResolution: "bundler"`.
- Internal packages are consumed as TypeScript source: `"exports": { ".": "./src/index.ts" }`. No build step; run with `tsx`, check with `tsc --noEmit`.
- Package names: `@dailies/core`, `@dailies/ingest`, `@dailies/agent`, `@dailies/verify`, `@dailies/voice`, `@dailies/reel`, `@dailies/pipeline`, `@dailies/cli`.
- A package imports another only through its index. Shared types live in `@dailies/core` and nowhere else.
- A task edits files only inside the directories listed under its **Files**. Do not change another package's `package.json`.
- Tests: vitest, files `packages/<name>/test/*.test.ts`. Run one package with `pnpm --filter @dailies/<name> test`.
- No secret ever enters the repository. Configuration comes from `.env` through `loadEnv()`.
- Every model call goes through `@dailies/agent`. No other package imports `openai`.
- Model ids on the gateway: `claude-sonnet-4.6`, `claude-haiku`, `nova-pro`. Gateway base URL: `LITELLM_BASE_URL`. Stay under 50 requests per minute.
- Trace endpoint: `https://ingest.neatlogs.com`.
- A verdict is `verified` only on positive evidence. Anything unknown is `unverifiable`, never `verified` and never `contradicted`.
- Commit after every green test cycle with a short imperative message.
- Once code exists, locate it with `entire graph search` before broad grep, as `CLAUDE.md` instructs.

## Review Focus

1. A repository with no checkpoints, or none inside the window: the run ends early with a clear message and no render. Pinned in Task 2 and Task 10.
2. A tool result of several megabytes or with ANSI colour codes: entries are truncated head-and-tail, colour codes are stripped, memory stays flat. Pinned in Task 2 and Task 4.
3. A claim quote that differs from the transcript only by whitespace or Markdown marks: still matched. A quote that is not in the entry: dropped. Pinned in Task 4.
4. A test run whose output the parser does not recognise: `unknown`, so the claim is `unverifiable`. Pinned in Task 4.
5. Narration audio whose pause count does not equal the line count: timings fall back to proportional alignment and never throw. Pinned in Task 5.
6. A model reply that is not valid JSON for the schema: one repair turn, then the stage fails and the runner retries it. Pinned in Task 3.
7. A secret inside a human prompt or a tool result: redacted at ingest, before any model or renderer sees it. Pinned in Task 1 and Task 2.

## File Structure

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.config.ts  .nvmrc
packages/core/src/      schema.ts ids.ts redact.ts env.ts budget.ts facts.ts index.ts
packages/ingest/src/    git.ts checkpoints.ts transcript.ts trailers.ts window.ts index.ts
packages/agent/src/     router.ts meter.ts limiter.ts loop.ts tools.ts trace.ts mock.ts index.ts
packages/verify/src/    commands.ts results.ts rules.ts quote.ts ground.ts style.ts index.ts
packages/voice/src/     gemini.ts wav.ts silence.ts align.ts index.ts
packages/reel/src/      timeline.ts srt.ts theme.ts render.ts index.ts
packages/reel/src/remotion/   index.ts Root.tsx Reel.tsx scenes/*.tsx
packages/pipeline/src/  db.ts store.ts runner.ts types.ts index.ts
packages/pipeline/src/stages/   ingest.ts edit.ts verify.ts script.ts ground.ts voice.ts render.ts review.ts gate.ts
packages/pipeline/src/prompts/  editor.ts extractor.ts judge.ts writer.ts entail.ts reviewer.ts
packages/cli/src/       index.ts run.ts verify.ts
packages/cli/bin/       dailies entire-dailies
```

## Task order

Task 1 first, alone. Then Tasks 2–7 in parallel, each in its own worktree. Then Tasks 8 and 9 in parallel. Then Task 10.

---

### Task 1: Workspace and core contracts

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.nvmrc`
- Create: `packages/core/**`
- Create: `packages/{ingest,agent,verify,voice,reel,pipeline,cli}/{package.json,tsconfig.json,src/index.ts}` (index exports nothing yet)

**Interfaces:**
- Produces: everything exported from `@dailies/core` below. Later tasks rely on these exact names.

Dependencies to declare and install here so later tasks do not touch lockfiles:

| Package | Dependencies |
|---|---|
| root (dev) | `typescript`, `vitest`, `tsx`, `@types/node` |
| core | `zod` |
| agent | `openai`, `neatlogs`, `zod`, `@dailies/core` |
| ingest, verify, voice | `@dailies/core` |
| reel | `remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/media`, `@remotion/google-fonts`, `react`, `react-dom`, `@types/react` (dev), `@dailies/core` |
| pipeline | `better-sqlite3`, `@types/better-sqlite3` (dev), all `@dailies/*` |
| cli | `@dailies/core`, `@dailies/pipeline` |

- [ ] **Step 1: Create the workspace files.**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Root `package.json`:
```json
{
  "name": "dailies",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b --noEmit",
    "dailies": "tsx packages/cli/src/index.ts"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "jsx": "react-jsx", "resolveJsonModule": true, "noEmit": true, "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'], testTimeout: 20000 } });
```

Each package `package.json` follows this shape (shown for core):
```json
{ "name": "@dailies/core", "version": "0.1.0", "private": true, "type": "module",
  "exports": { ".": "./src/index.ts" }, "scripts": { "test": "vitest run --dir test" },
  "dependencies": { "zod": "latest" } }
```
Internal dependencies use `"@dailies/core": "workspace:*"`. Run `pnpm install` and commit the lockfile.

- [ ] **Step 2: Write the failing schema and redaction tests** in `packages/core/test/schema.test.ts` and `packages/core/test/redact.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { Claim, Scene, Storyboard, redact, computeFacts, entryId } from '../src/index';

describe('schema', () => {
  it('rejects a claim without a quote', () => {
    expect(Claim.safeParse({ id: 'c1', sessionId: 's', entryId: 's:1', kind: 'tests_pass' }).success).toBe(false);
  });
  it('requires evidence on every narration line', () => {
    const scene = { id: 'sc1', type: 'prompt', quote: 'q', sessionId: 's', entryId: 's:0',
      lines: [{ id: 'l1', text: 'The prompt asked for a retry.', evidence: [] }] };
    expect(Scene.safeParse(scene).success).toBe(false);
  });
  it('builds stable entry ids', () => { expect(entryId('abc', 7)).toBe('abc:7'); });
});

describe('redact', () => {
  it('masks provider keys and keeps the variable name', () => {
    const r = redact('export OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345 # ok');
    expect(r.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(r.text).toContain('OPENAI_API_KEY=');
    expect(r.hits).toBeGreaterThan(0);
  });
  it('masks bearer tokens, GitHub tokens, AWS key ids, JWTs and private keys', () => {
    const src = [
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----',
    ].join('\n');
    const r = redact(src);
    for (const s of ['abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'MIIEvQ']) expect(r.text).not.toContain(s);
    expect(r.hits).toBe(5);
  });
  it('leaves git SHAs and ordinary prose alone', () => {
    const src = 'commit 3c66306a912e51b2e07432322d48ad4f63ebce3d fixed the retry loop';
    expect(redact(src)).toEqual({ text: src, hits: 0 });
  });
});
```

- [ ] **Step 3: Run `pnpm --filter @dailies/core test`.** Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `packages/core/src/schema.ts`.**

```ts
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
```

- [ ] **Step 5: Implement `ids.ts`, `redact.ts`, `env.ts`, `budget.ts`, `facts.ts`, `index.ts`.**

```ts
// ids.ts
import { randomBytes } from 'node:crypto';
export const entryId = (sessionId: string, index: number) => `${sessionId}:${index}`;
export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
```

```ts
// redact.ts
const RULES: [string, RegExp][] = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ['bearer', /(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/g],
  ['provider_key', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g],
  ['github_token', /\bgh[pousr]_[A-Za-z0-9]{20,}/g],
  ['aws_key_id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['google_key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['assignment', /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*["']?)([^\s"'\[]{8,})/g],
];
export function redact(input: string): { text: string; hits: number } {
  let hits = 0; let text = input;
  for (const [kind, re] of RULES) {
    text = text.replace(re, (...m) => {
      hits += 1;
      const keep = kind === 'bearer' || kind === 'assignment' ? (m[1] as string) : '';
      return `${keep}[REDACTED:${kind}]`;
    });
  }
  return { text, hits };
}
```
The `assignment` rule skips values that already start with `[` so an earlier replacement is not counted twice.

```ts
// env.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export interface Env {
  neatlogsApiKey: string | null; neatlogsEndpoint: string;
  gatewayKey: string | null; gatewayBaseUrl: string;
  veniceKey: string | null; geminiKeys: string[]; dataDir: string;
}
export function loadEnv(cwd = process.cwd()): Env {
  const file = resolve(cwd, '.env');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  const e = process.env;
  return {
    neatlogsApiKey: e.NEATLOGS_API_KEY || null,
    neatlogsEndpoint: e.NEATLOGS_ENDPOINT || 'https://ingest.neatlogs.com',
    gatewayKey: e.LITELLM_API_KEY || null,
    gatewayBaseUrl: e.LITELLM_BASE_URL || 'https://litellm.vision.aivar.app/v1',
    veniceKey: e.VENICE_API_KEY || null,
    geminiKeys: (e.GEMINI_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean),
    dataDir: resolve(cwd, e.DAILIES_DATA_DIR || '.dailies'),
  };
}
```

```ts
// budget.ts
import { z } from 'zod';
export const Budget = z.object({ maxCostPerReelUsd: z.number(), maxTtsCalls: z.number().int(), maxRenderSec: z.number() });
export type Budget = z.infer<typeof Budget>;
export const DEFAULT_BUDGET: Budget = { maxCostPerReelUsd: 0.6, maxTtsCalls: 3, maxRenderSec: 300 };
export class BudgetExceededError extends Error {
  constructor(public spentUsd: number, public limitUsd: number) { super(`budget exceeded: ${spentUsd.toFixed(4)} > ${limitUsd}`); }
}
```

```ts
// facts.ts
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
```
`index.ts` re-exports all five modules. Add `.dailies/` to `.gitignore`.

- [ ] **Step 6: Run `pnpm --filter @dailies/core test` and `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "workspace and core contracts"`.

---

### Task 2: Ingest

**Files:** `packages/ingest/src/**`, `packages/ingest/test/**`

**Interfaces:**
- Consumes: `Entry`, `Session`, `IngestArtifact`, `DiffIndex`, `redact`, `entryId` from `@dailies/core`.
- Produces:
```ts
export interface CheckpointRef { id: string; treeish: string; layout: 'refs' | 'branch' }
export async function git(repoDir: string, args: string[], opts?: { maxBuffer?: number }): Promise<string>
export async function cloneOrUpdate(repoUrlOrPath: string, dataDir: string): Promise<string>           // returns repoDir
export async function listCheckpointRefs(repoDir: string): Promise<CheckpointRef[]>
export function parseTranscript(sessionId: string, jsonl: string): { entries: Entry[]; redactions: number }
export async function mapCheckpointCommits(repoDir: string): Promise<Map<string, string[]>>            // checkpoint id -> SHAs
export async function getDiff(repoDir: string, sha: string): Promise<Record<string, string>>           // path -> patch text
export async function ingest(opts: { repoUrl: string; dataDir: string; since: string; until: string; maxSessions?: number }): Promise<IngestArtifact>
export class NoCheckpointsError extends Error {}
```

Facts about the data, confirmed on real repositories:

- **Refs layout:** each ref `refs/entire/checkpoints/<shard>/<id>` points at a commit whose tree has `metadata.json` and `<n>/metadata.json`, `<n>/prompt.txt`, `<n>/transcript.jsonl`, `<n>/full.jsonl` for session index `n`.
- **Branch layout:** branch `entire/checkpoints/v1` has the same content under `<first two chars of id>/<rest of id>/`.
- **Root `metadata.json`:** `checkpoint_id`, `branch`, `sessions[]`, `token_usage`.
- **Session `metadata.json`:** `session_id`, `created_at`, `agent`, `model`, `branch`, `files_touched[]`, `token_usage{input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens}`, `session_metrics.turn_count`.
- **`transcript.jsonl`:** one JSON object per line: `{ type: 'user' | 'assistant', ts, content: [...] }`.
  - user blocks: `{ id, text }`; blocks with `type: 'image'` are skipped.
  - assistant blocks: `{ type: 'text', text }` or `{ type: 'tool_use', id, name, input, result? }` where `result` is `{ output: string, status: 'success' | string }`.
- **Commit link:** a commit body line `Entire-Checkpoint: <id>`.

Parsing rules:

- A user text block becomes a `user` entry. An assistant text block becomes an `assistant` entry.
- A `tool_use` block becomes a `tool_call` entry (`toolName`, `toolUseId`, `command = input.command` when it is a string, `filePath = input.file_path` when it is a string, `text = JSON.stringify(input)` cut to 4000 characters). When `result` exists it is followed by a `tool_result` entry with the same `toolName` and `toolUseId`, `isError = result.status !== 'success'`.
- Tool output is stripped of ANSI escape codes and, when longer than 8000 characters, reduced to its first 3000 and last 5000 characters joined by `\n…[truncated]…\n`. Test summaries sit at the end, so the tail is kept longer.
- Every `text` and `command` passes through `redact`.
- A session keeps at most 5000 entries. A malformed line is skipped, not fatal.
- `startedAt` is the first entry timestamp, else `created_at`. `endedAt` is the last entry timestamp.
- A session is inside the window when `startedAt <= until` and `(endedAt ?? startedAt) >= since`. Keep the newest `maxSessions` (default 12).
- The same `session_id` appearing in several checkpoints is merged: keep the longest transcript, union the checkpoint ids and commits.
- `cloneOrUpdate`: a local path is used in place. A URL is cloned with `git clone --filter=blob:none` into `<dataDir>/repos/<owner>__<name>`, or fetched if present. Then `git fetch origin '+refs/entire/*:refs/entire/*'` and `git fetch origin '+refs/heads/entire/*:refs/remotes/origin/entire/*'`; a failure of either fetch is tolerated.
- `ingest` throws `NoCheckpointsError` when no checkpoint ref exists. When checkpoints exist but none fall inside the window it returns an artifact with `sessions: []`.
- `diffs` holds `getDiff` output for every linked commit under keys `${sha}:${path}`, each patch cut to 6000 characters, at most 40 files per commit.

- [ ] **Step 1: Write the fixture builder** `packages/ingest/test/fixture.ts`: `makeRepo(spec)` creates a temp git repo with one normal commit carrying an `Entire-Checkpoint: <id>` trailer and writes checkpoint trees in either layout using `git hash-object -w`, `git mktree` and `git commit-tree` then `git update-ref`. It returns the repo path. The spec is `{ layout, checkpoints: [{ id, sessions: [{ sessionId, createdAt, lines: object[] }] }] }`.
- [ ] **Step 2: Write failing tests** `packages/ingest/test/ingest.test.ts`:

```ts
it('reads sessions from the refs layout and links commits by trailer');        // 1 checkpoint, 1 session, 4 entries, commits.length === 1
it('reads the same content from the branch layout');
it('pairs a tool call with its result and marks failed results', () => {
  const { entries } = parseTranscript('s1', [
    JSON.stringify({ type: 'user', ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'run the tests' }] }),
    JSON.stringify({ type: 'assistant', ts: '2026-10-10T07:00:05Z', content: [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 failed', status: 'error' } },
      { type: 'text', text: 'All tests pass.' } ] }),
  ].join('\n'));
  expect(entries.map((e) => e.kind)).toEqual(['user', 'tool_call', 'tool_result', 'assistant']);
  expect(entries[1]!.command).toBe('pnpm test');
  expect(entries[2]!.isError).toBe(true);
  expect(entries[3]!.id).toBe('s1:3');
});
it('strips ANSI codes and truncates a 2 MB tool output head-and-tail');         // text.length <= 8100, ends with the original tail
it('redacts a key that appears in a user prompt and counts it');
it('skips malformed lines and image blocks');
it('throws NoCheckpointsError for a repo without checkpoints');
it('returns no sessions when checkpoints exist but none are in the window');
it('merges one session that appears in two checkpoints');
```
Write each `it` with a real body in the style of the third one, using `makeRepo`.
- [ ] **Step 3: Run the tests.** Expected: FAIL.
- [ ] **Step 4: Implement** `git.ts` (`execFile('git', args, { cwd, maxBuffer: 64 MB })`), `checkpoints.ts`, `transcript.ts`, `trailers.ts`, `window.ts`, `index.ts` to the rules above.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Run against a real repository** and record the output in the commit message body: `pnpm tsx -e "import('@dailies/ingest').then(async m => { const a = await m.ingest({ repoUrl: 'https://github.com/entireio/cli', dataDir: '.dailies', since: '2026-01-01T00:00:00Z', until: new Date().toISOString(), maxSessions: 3 }); console.log(a.sessions.map(s => [s.id, s.entries.length, s.commits.length])); })"`. Expected: three sessions with non-zero entry counts.
- [ ] **Step 7: Commit.**

---

### Task 3: Agent runtime

**Files:** `packages/agent/src/**`, `packages/agent/test/**`

**Interfaces:**
- Consumes: `Env`, `BudgetExceededError` from `@dailies/core`.
- Produces:
```ts
export type Role = 'editor' | 'extractor' | 'judge' | 'writer' | 'vision';
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | ContentPart[] | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Completion { message: ChatMessage; inputTokens: number; outputTokens: number; model: string; provider: string }
export interface ModelClient { complete(req: { role: Role; messages: ChatMessage[]; tools?: Tool[]; maxTokens?: number }): Promise<Completion> }

export class CostMeter { constructor(limitUsd: number); add(usd: number): void; total(): number; assertWithin(): void }
export function createRouter(env: Env, meter: CostMeter): ModelClient
export function createMockClient(reply: (req: { role: Role; messages: ChatMessage[] }) => ChatMessage): ModelClient

export interface Tool { name: string; description: string; parameters: z.ZodTypeAny; execute(args: unknown): Promise<unknown> }
export function defineTool<S extends z.ZodTypeAny>(t: { name: string; description: string; parameters: S; execute(args: z.infer<S>): Promise<unknown> }): Tool

export async function completeJson<T>(o: { client: ModelClient; role: Role; name: string; system: string; user: string | ContentPart[]; output: z.ZodType<T> }): Promise<T>
export async function runAgent<T>(o: { client: ModelClient; role: Role; name: string; system: string; user: string; tools: Tool[]; output: z.ZodType<T>; maxSteps?: number }): Promise<{ output: T; steps: number }>
export class AgentStepLimitError extends Error {}
export class ModelOutputError extends Error {}

export async function initTracing(env: Env, workflowName: string): Promise<void>
export async function shutdownTracing(): Promise<void>
export function traced<A extends unknown[], R>(kind: 'WORKFLOW' | 'CHAIN' | 'AGENT' | 'TOOL' | 'GUARDRAIL', name: string, fn: (...a: A) => Promise<R>): (...a: A) => Promise<R>
export async function guard(name: string, check: () => Promise<{ pass: boolean; reasons: string[] }>): Promise<{ pass: boolean; reasons: string[] }>
```

Behaviour:

- **Router.** Role to model: editor and writer and vision `claude-sonnet-4.6`, extractor `claude-haiku`, judge `nova-pro`. The gateway client is `new OpenAI({ baseURL: env.gatewayBaseUrl, apiKey: env.gatewayKey, fetch })` wrapped with `wrapOpenAI` from `neatlogs` when tracing is initialised.
- **Cost.** The custom `fetch` reads the `x-litellm-response-cost` response header and calls `meter.add`. When the header is absent it adds a table estimate (per million tokens, input/output: `claude-sonnet-4.6` 3/15, `claude-haiku` 1/5, `nova-pro` 0.8/3.2). `meter.assertWithin()` is called before every request and throws `BudgetExceededError`.
- **Limiter.** A shared token bucket of 50 requests per minute; callers await a slot.
- **Retries.** HTTP 429 and 5xx: three attempts with 1 s, 2 s, 4 s waits. If they fail and `env.veniceKey` is set, the request is sent to `https://api.venice.ai/api/v1` with the model named by `VENICE_MODEL_<ROLE>` (for example `VENICE_MODEL_WRITER`); without that variable there is no fallback and the error propagates.
- **`completeJson`.** Sends system and user, asks for JSON only, strips code fences, parses with the zod schema. On failure it sends one repair turn quoting the zod error, then throws `ModelOutputError`.
- **`runAgent`.** OpenAI tool-calling loop. Each tool call is validated with the tool's zod schema and executed inside a `TOOL` span; a validation or execution error is returned to the model as the tool message `{"error": "..."}` instead of throwing. The loop ends when the assistant replies without tool calls; that reply is parsed like `completeJson`. More than `maxSteps` (default 24) rounds throws `AgentStepLimitError`. The whole run is an `AGENT` span named `name`.
- **Tracing.** `initTracing` calls `init({ apiKey, endpoint, workflowName })` and is a no-op without a key. `traced` wraps `span({ kind, name }, fn)`. `guard` runs inside a `GUARDRAIL` span and returns the check result unchanged.

- [ ] **Step 1: Write failing tests** `packages/agent/test/*.test.ts` using `createMockClient`:

```ts
it('completeJson parses fenced JSON', async () => {
  const client = createMockClient(() => ({ role: 'assistant', content: '```json\n{"n":2}\n```' }));
  await expect(completeJson({ client, role: 'extractor', name: 't', system: 's', user: 'u', output: z.object({ n: z.number() }) })).resolves.toEqual({ n: 2 });
});
it('completeJson sends one repair turn then throws ModelOutputError', async () => {
  let calls = 0;
  const client = createMockClient(() => { calls += 1; return { role: 'assistant', content: 'not json' }; });
  await expect(completeJson({ client, role: 'extractor', name: 't', system: 's', user: 'u', output: z.object({ n: z.number() }) })).rejects.toBeInstanceOf(ModelOutputError);
  expect(calls).toBe(2);
});
it('runAgent executes a tool call and returns the final JSON');     // mock replies with a tool call first, then {"sum":5}
it('runAgent returns tool errors to the model instead of throwing'); // tool throws; next request contains {"error":
it('runAgent throws AgentStepLimitError after maxSteps');
it('CostMeter.assertWithin throws BudgetExceededError past the limit', () => {
  const m = new CostMeter(0.01); m.add(0.02);
  expect(() => m.assertWithin()).toThrow(BudgetExceededError);
});
it('the limiter delays the 51st request inside one minute');         // fake timers
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `meter.ts`, `limiter.ts`, `tools.ts`, `mock.ts`, `loop.ts`, `trace.ts`, `router.ts`, `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Live smoke test** `packages/agent/test/live.test.ts`, skipped unless `LITELLM_API_KEY` is set: one `completeJson` call with role `extractor` returning `{"ok":true}`, one `runAgent` call with an `add` tool, then assert `meter.total() > 0`. Run it once with the key loaded and paste the measured cost into the commit body.
- [ ] **Step 6: Commit.**

---

### Task 4: Verification rules and the grounding gate

**Files:** `packages/verify/src/**`, `packages/verify/test/**`

**Interfaces:**
- Consumes: `Session`, `Entry`, `Claim`, `Line`, `Facts`, `DiffIndex`, `EvidenceRef` from `@dailies/core`.
- Produces:
```ts
export type CommandClass = 'test' | 'build' | 'typecheck' | 'lint' | 'other';
export type RunOutcome = 'pass' | 'fail' | 'unknown';
export interface ToolRun { callEntryId: string; resultEntryId: string | null; index: number; command: string; cls: CommandClass; outcome: RunOutcome }
export function classifyCommand(command: string): CommandClass
export function parseOutcome(cls: CommandClass, output: string, isError: boolean): RunOutcome
export function collectRuns(session: Session): ToolRun[]
export function normalize(text: string): string                       // collapse whitespace, drop * _ ` marks
export function quoteMatches(quote: string, text: string): boolean
export function verifyClaim(claim: Claim, session: Session): Claim    // sets verdict, reason, evidence; leaves 'implemented' untouched
export function verifyClaims(claims: Claim[], sessions: Session[]): Claim[]
export function lintStyle(text: string): string[]                     // empty array means clean
export function checkLine(line: Line, ctx: { sessions: Session[]; facts: Facts; diffs: DiffIndex }, o?: { skipStyle?: boolean }): { ok: boolean; reasons: string[] }
```

Rules:

- **`classifyCommand`.** Split the command on `&&`, `||`, `;` and `|`; classify each part; return the first non-`other` class in the order test, typecheck, lint, build.
  - test: `vitest`, `jest`, `pytest`, `mocha`, `playwright test`, `go test`, `cargo test`, `dotnet test`, `rspec`, `phpunit`, `python -m unittest`, `<npm|pnpm|yarn|bun> [run] test`, `make test`.
  - typecheck: `tsc`, `mypy`, `pyright`.
  - lint: `eslint`, `biome`, `ruff`, `flake8`, `<pm> [run] lint`.
  - build: `<pm> [run] build`, `next build`, `vite build`, `cargo build`, `go build`, `make` or `make build`.
- **`parseOutcome`.** Strip ANSI codes first. `isError` true gives `fail`.
  - test: `fail` on `(\d+) (failed|failing)` with a count above zero, on `Tests?:\s+\d+ failed`, on a line starting `FAIL`, on `AssertionError`. `pass` when there is no fail marker and one of `(\d+) passed`, a line starting `PASS`, a line starting `ok ` followed by a package path, `test result: ok`. Otherwise `unknown`.
  - typecheck: `fail` on `error TS\d+` or `Found [1-9]\d* errors?`; `pass` on `Found 0 errors` or empty output; otherwise `unknown`.
  - lint and build: `pass` on empty output or `compiled successfully`, `built in`, `Done in`, `0 errors`, `0 problems`; `fail` on `[1-9]\d* errors?` or `[1-9]\d* problems?`; otherwise `unknown`.
- **`collectRuns`.** Every `tool_call` entry with a `command` whose class is not `other`, paired with the `tool_result` entry sharing its `toolUseId`. No result entry gives `outcome: 'unknown'`.
- **`tests_pass`.** Consider test runs before the claim's entry. None: `unverifiable`, reason `no test run is recorded before this message`. Last run `fail`: `contradicted`. Last run `unknown`: `unverifiable`. Last run `pass`: if a `tool_call` with `toolName` in `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and a `filePath` not ending in `.md` sits between that run and the claim, `stale` with the edit as evidence; else `verified`. Evidence is the run's call and result entries.
- **`build_passes`.** The same over runs of class `build` or `typecheck`.
- **`ran_command`.** Find the last `tool_call` before the claim whose normalised command contains the normalised `subject`. None: `unverifiable`. Its result `isError`: `contradicted`. Otherwise `verified`.
- **`fixed_error`.** Find the first `tool_result` containing the normalised `subject`. None: `unverifiable`. Take the last later run before the claim with the same command class. None: `unverifiable`. Its output still contains the subject or its outcome is `fail`: `contradicted`. Otherwise `verified`.
- A claim whose `quote` does not match its entry by `quoteMatches` gets `unverifiable` with reason `quote not found in transcript`. Callers drop such claims; the rule here is the safety net.
- **`lintStyle`.** Returns a reason for: more than one sentence; more than 26 words; an em dash or an exclamation mark; a number written as a word from `one` to `twenty`; any banned phrase from `delve`, `seamless`, `robust`, `leverage`, `cutting-edge`, `game-changer`, `dive into`, `unleash`, `supercharge`, `effortless`, `revolutioniz`, `it's worth noting`, `not just`.
- **`checkLine`.** Fails with a reason when: an `entry` ref names an unknown entry, or its `quote` does not match that entry; a `diff` ref names a key missing from `diffs`, or its `quote` is not in that patch; a `stat` ref names a key missing from `facts`; a number in the line text (`\d+(?:\.\d+)?`) is neither the value of a referenced stat nor present in a referenced entry or patch; `lintStyle` reports anything (unless `skipStyle` is set).

- [ ] **Step 1: Write failing tests.** Build sessions with a small helper `session(entries)` in `packages/verify/test/helpers.ts`. Cases, each a full test:

```ts
it('classifies commands', () => {
  expect(classifyCommand('cd app && pnpm test -- --run')).toBe('test');
  expect(classifyCommand('npx tsc --noEmit')).toBe('typecheck');
  expect(classifyCommand('git status')).toBe('other');
});
it('parses outcomes and strips colour codes', () => {
  expect(parseOutcome('test', '\u001b[31m Tests  2 failed\u001b[0m | 14 passed', false)).toBe('fail');
  expect(parseOutcome('test', ' Test Files  3 passed (3)\n Tests  14 passed (14)', false)).toBe('pass');
  expect(parseOutcome('test', 'ok  \tgithub.com/x/y\t0.21s', false)).toBe('pass');
  expect(parseOutcome('test', 'some unrelated text', false)).toBe('unknown');
  expect(parseOutcome('typecheck', 'src/a.ts(3,1): error TS2322: nope', false)).toBe('fail');
});
it('tests_pass is contradicted when the last run failed');
it('tests_pass is verified when the last run passed and nothing was edited after it');
it('tests_pass is stale when a source file was edited after the last passing run');
it('tests_pass ignores an edit to a .md file');
it('tests_pass is unverifiable when no run exists, and when the output is unrecognised');
it('ran_command is unverifiable when the command is absent and contradicted when it errored');
it('fixed_error is verified only when a later run of the same class lacks the error text');
it('matches a quote that differs by whitespace and Markdown marks, rejects a missing quote', () => {
  expect(quoteMatches('All tests pass now', 'Done. **All tests\n pass** now.')).toBe(true);
  expect(quoteMatches('All tests pass', 'I did not run the tests.')).toBe(false);
});
it('flipping a passing result to failing flips verified to contradicted, and back');   // the mutation property
it('checkLine rejects an unknown entry ref, a wrong number, and a banned phrase; accepts a clean line');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `commands.ts`, `results.ts`, `quote.ts`, `rules.ts`, `style.ts`, `ground.ts`, `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 5: Voice

**Files:** `packages/voice/src/**`, `packages/voice/test/**`

**Interfaces:**
- Consumes: `LineTiming` from `@dailies/core`.
- Produces:
```ts
export interface TtsProvider { name: string; synthesize(text: string, voice: string): Promise<{ pcm: Buffer; sampleRate: number }> }
export class TtsQuotaError extends Error {}
export function createGeminiTts(keys: string[], o?: { models?: string[]; fetchImpl?: typeof fetch }): TtsProvider
export function writeWav(path: string, pcm: Buffer, sampleRate: number): void
export async function detectSilences(wavPath: string, o?: { noiseDb?: number; minSec?: number }): Promise<{ start: number; end: number }[]>
export function alignLines(lines: { id: string; text: string }[], totalSec: number, silences: { start: number; end: number }[]): LineTiming[]
export function estimateTimings(lines: { id: string; text: string }[]): LineTiming[]
export async function voiceLines(lines: { id: string; text: string }[], o: { provider: TtsProvider; voice: string; outDir: string; maxCalls: number }): Promise<{ mode: 'voiced' | 'captions'; audioPath: string | null; timings: LineTiming[]; calls: number }>
```

Behaviour:

- **One call per reel.** The free tier allows few generations per key per day, so all lines are sent as one text, joined by blank lines, prefixed with `Read as a calm, dry documentary narrator. Pause for a full second between paragraphs.\n\n`.
- **Gemini request.** `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, header `x-goog-api-key`, body `{ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } }`. Audio is base64 16-bit mono PCM at `candidates[0].content.parts[0].inlineData.data`; the sample rate is the `rate=` value of `mimeType` (24000 when absent).
- **Rotation.** Models are tried in order `gemini-3.1-flash-tts-preview`, `gemini-3.8-flash-tts`, `gemini-2.5-flash-preview-tts`. HTTP 429 moves to the next key; when every key is exhausted for a model the next model is tried; when all fail `TtsQuotaError` is thrown. HTTP 5xx is retried twice with a 2 s wait.
- **`detectSilences`.** Runs `ffmpeg -i <wav> -af silencedetect=noise=<noiseDb>dB:d=<minSec> -f null -` (defaults -35 and 0.45) and parses `silence_start` / `silence_end` from stderr.
- **`alignLines`.** Drop silences touching the start or end of the audio. With `n` lines, `n - 1` boundaries are needed. The expected position of boundary `i` is `totalSec` times the cumulative share of characters up to line `i`. Each boundary takes the unused silence whose midpoint is nearest to its expected position and within 25% of `totalSec` of it; a boundary with no such silence uses the expected position. Line `i` runs from boundary `i - 1` to boundary `i` (0 and `totalSec` at the ends). The function never throws and always returns `n` contiguous, non-overlapping timings.
- **`estimateTimings`.** 15 characters per second, minimum 1.6 s per line, contiguous from zero.
- **`voiceLines`.** Uses a cached WAV under `outDir/cache/<sha256 of model list, voice and text>.wav` when present (zero calls). Otherwise synthesises, writes `outDir/narration.wav`, detects silences and aligns. On `TtsQuotaError`, or when `maxCalls` is zero, it returns `mode: 'captions'`, `audioPath: null` and `estimateTimings`.

- [ ] **Step 1: Write failing tests.**

```ts
it('writes a valid 44-byte WAV header', () => { /* RIFF, WAVE, fmt , data, byte rate = sampleRate * 2 */ });
it('aligns exactly when the pause count matches', () => {
  const t = alignLines([{ id: 'a', text: 'x'.repeat(30) }, { id: 'b', text: 'x'.repeat(30) }], 10, [{ start: 4.8, end: 5.4 }]);
  expect(t).toEqual([{ lineId: 'a', startSec: 0, endSec: 5.1 }, { lineId: 'b', startSec: 5.1, endSec: 10 }]);
});
it('picks the nearest pauses when there are more pauses than boundaries');
it('falls back to proportional positions when there are fewer pauses than boundaries');
it('returns contiguous timings with no pauses at all');
it('detects the pause in a generated clip');   // ffmpeg -f lavfi: 1 s sine, 0.8 s silence, 1 s sine -> one silence near 1.0–1.8
it('rotates to the next key on 429 and to the next model when all keys fail');   // fetchImpl stub
it('returns captions mode with estimated timings on TtsQuotaError');
it('reuses the cache and makes zero calls the second time');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `wav.ts`, `silence.ts`, `align.ts`, `gemini.ts`, `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** Do not add a live Gemini test: each call spends daily quota.

---

### Task 6: Reel renderer

**Files:** `packages/reel/src/**`, `packages/reel/test/**`

**Interfaces:**
- Consumes: `Storyboard`, `Scene`, `LineTiming`, `RenderArtifact` from `@dailies/core`.
- Produces:
```ts
export interface Timeline { fps: number; totalFrames: number; audioStartFrame: number; scenes: { sceneId: string; startFrame: number; durationInFrames: number }[] }
export function buildTimeline(sb: Storyboard, timings: LineTiming[], fps?: number): Timeline
export function toSrt(sb: Storyboard, timings: LineTiming[], audioOffsetSec: number): string
export async function renderReel(i: { storyboard: Storyboard; timings: LineTiming[]; audioPath: string | null; outDir: string }): Promise<RenderArtifact>
export async function renderStills(i: { storyboard: Storyboard; timings: LineTiming[]; outDir: string }): Promise<{ sceneId: string; path: string }[]>
```

Behaviour:

- **Timeline.** 30 fps. The title scene lasts 2.5 s and plays before the narration; `audioStartFrame` is its length. Each spoken scene starts at the start of its first line and ends at the start of the next spoken scene's first line; the last spoken scene ends at the end of its last line plus 0.4 s. The end scene lasts 3 s. Scene frames are contiguous and `totalFrames` is their sum.
- **Subtitles.** One cue per line, shifted by `audioOffsetSec`, `HH:MM:SS,mmm` timestamps.
- **Rendering.** `bundle({ entryPoint: <src/remotion/index.ts>, publicDir: <outDir>/public })` with the narration copied to `public/narration.wav`; `selectComposition({ id: 'Reel', inputProps })`; `renderMedia({ codec: 'h264', outputLocation: <outDir>/reel.mp4 })`. The poster is `renderStill` at the middle of the title scene. `renderStills` writes one PNG per scene at that scene's middle frame; the review stage uses them.
- **Composition.** `Reel.tsx` maps each timeline scene to a `<Sequence>` and switches on `scene.type`. Audio is one `<Audio src={staticFile('narration.wav')}>` inside a `<Sequence from={audioStartFrame}>`, omitted when there is no audio. In captions mode the current line's text is drawn as a caption bar.
- **Scenes.** One component per scene type in `src/remotion/scenes/`. All colours, type sizes, radii and font families come from `theme.ts`; no scene hard-codes a visual value, so the art direction can change in one file. Text is clamped to the limits the schema already enforces. Motion uses `interpolate` and `spring` only.
  - `Title`: repo name, window label, session and commit counts.
  - `Prompt`: the quoted human prompt, typed on.
  - `Terminal`: commands and outputs revealed step by step, a pass or fail mark per step.
  - `Diff`: the patch with added and removed lines coloured, counters for both.
  - `Stats`: up to six labelled values counting up.
  - `Flag`: the agent's quote, the verdict stamp, the recorded reality.
  - `End`: repo, verified and flagged counts.

- [ ] **Step 1: Write failing tests** for the pure parts, with a `fixtureStoryboard()` helper holding one scene of each type:

```ts
it('places the title before the audio and keeps scenes contiguous', () => {
  const tl = buildTimeline(sb, timings);
  expect(tl.audioStartFrame).toBe(75);
  expect(tl.scenes[0]).toMatchObject({ startFrame: 0, durationInFrames: 75 });
  for (let i = 1; i < tl.scenes.length; i++) expect(tl.scenes[i]!.startFrame).toBe(tl.scenes[i - 1]!.startFrame + tl.scenes[i - 1]!.durationInFrames);
  expect(tl.totalFrames).toBe(tl.scenes.reduce((n, s) => n + s.durationInFrames, 0));
});
it('gives the end scene 90 frames');
it('writes SRT cues shifted by the audio offset', () => {
  expect(toSrt(sb, timings, 2.5).split('\n').slice(0, 3)).toEqual(['1', '00:00:02,500 --> 00:00:06,100', sb.scenes[1]!.lines[0]!.text]);
});
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `timeline.ts`, `srt.ts`, `theme.ts`, then the Remotion entry, `Root.tsx`, `Reel.tsx` and the seven scenes, then `render.ts`.
- [ ] **Step 4: Run the unit tests.** Expected: PASS.
- [ ] **Step 5: Render smoke test** `packages/reel/test/render.test.ts` with a 120 s timeout: render the fixture storyboard without audio, then assert the MP4 exists and `ffprobe` reports 1920x1080, h264 and a duration within 0.2 s of `totalFrames / 30`. Also call `renderStills` and assert one PNG per scene.
- [ ] **Step 6: Open two of the stills and check them by eye** for overflow and empty frames; fix and re-render.
- [ ] **Step 7: Commit.**

---

### Task 7: Durable runner

**Files:** `packages/pipeline/src/{db.ts,store.ts,runner.ts,types.ts,index.ts}`, `packages/pipeline/test/runner.test.ts`

**Interfaces:**
- Consumes: `Budget`, `BudgetExceededError`, `newId` from `@dailies/core`.
- Produces:
```ts
export type StageName = 'ingest' | 'edit' | 'verify' | 'script' | 'ground' | 'voice' | 'render' | 'review' | 'gate';
export type RunStatus = 'running' | 'needs_approval' | 'blocked' | 'failed';
export interface RunRecord { id: string; repoUrl: string; since: string; until: string; status: RunStatus; reason: string | null; costUsd: number; loops: number; budget: Budget; createdAt: string }
export interface StageContext {
  run: RunRecord; dataDir: string; runDir: string;
  read<T>(stage: StageName): T;                         // artifact of a completed stage; throws if absent
  log(message: string): void;                           // appends an event
  feedback: string | null;                              // reason passed by the last loop-back, if any
}
export interface StageResult<T> { artifact: T; loopBackTo?: StageName; reason?: string; final?: { status: 'needs_approval' | 'blocked'; reason: string } }
export interface Stage<T = unknown> { name: StageName; maxAttempts: number; run(ctx: StageContext): Promise<StageResult<T>> }

export function openDb(path: string): Database
export function createRun(db: Database, i: { repoUrl: string; since: string; until: string; budget: Budget }): string
export function getRun(db: Database, id: string): RunRecord
export function listEvents(db: Database, runId: string, afterId?: number): { id: number; ts: string; stage: string | null; message: string }[]
export function addCost(db: Database, runId: string, usd: number): void
export async function runPipeline(db: Database, runId: string, stages: Stage[], o: { dataDir: string; sleep?: (ms: number) => Promise<void> }): Promise<RunStatus>
export function unfinishedRuns(db: Database): string[]
```

Schema (`db.ts`, created on open, WAL mode):
```sql
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, repo_url TEXT NOT NULL, since TEXT NOT NULL, until TEXT NOT NULL,
  status TEXT NOT NULL, reason TEXT, cost_usd REAL NOT NULL DEFAULT 0, loops INTEGER NOT NULL DEFAULT 0,
  budget TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stages (run_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, ended_at TEXT, error TEXT, PRIMARY KEY (run_id, name));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts TEXT NOT NULL, stage TEXT, message TEXT NOT NULL);
```

Behaviour:

- Artifacts are written as `<dataDir>/runs/<runId>/<stage>.json`. The write goes to a temp file and is renamed, so a crash never leaves half an artifact.
- `runPipeline` walks the stage list from the first stage whose status is not `done`. For each: mark `running` and increment `attempt`, call `run`, write the artifact, mark `done`.
- A thrown error is stored. `BudgetExceededError` ends the run as `blocked` with reason `budget`. Any other error is retried after `500 * 2^attempt` ms until `maxAttempts`, then the run is `failed`.
- `loopBackTo`: if `loops < 2`, increment it, reset that stage and every later stage to `pending`, set `feedback` to `reason` and continue from it. If `loops` is already 2 the run ends `blocked` with that reason.
- `final` ends the run with the given status. A run that completes every stage without `final` ends `needs_approval`.
- Calling `runPipeline` again on a `running` run resumes it. Completed stages are not executed again.

- [ ] **Step 1: Write failing tests** with in-memory stub stages that count their calls:

```ts
it('runs stages in order and stores readable artifacts');
it('retries a failing stage and succeeds on the second attempt');           // sleep injected, no real waiting
it('marks the run failed after maxAttempts');
it('resumes after a crash without re-running completed stages', async () => {
  const calls = { a: 0, b: 0 };
  const a: Stage = { name: 'ingest', maxAttempts: 1, run: async () => { calls.a += 1; return { artifact: 1 }; } };
  let crash = true;
  const b: Stage = { name: 'edit', maxAttempts: 1, run: async () => { calls.b += 1; if (crash) throw new Error('boom'); return { artifact: 2 }; } };
  const id = createRun(db, input);
  expect(await runPipeline(db, id, [a, b], opts)).toBe('failed');
  db.prepare("UPDATE runs SET status='running' WHERE id=?").run(id);       // simulate a process restart mid-stage
  db.prepare("UPDATE stages SET status='pending', attempt=0 WHERE run_id=? AND name='edit'").run(id);
  crash = false;
  expect(await runPipeline(db, id, [a, b], opts)).toBe('needs_approval');
  expect(calls).toEqual({ a: 1, b: 2 });
});
it('loops back at most twice, then blocks with the reason');
it('passes the loop-back reason to the stage as ctx.feedback');
it('ends blocked with reason budget on BudgetExceededError');
it('honours a final status returned by a stage');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `db.ts`, `store.ts`, `types.ts`, `runner.ts`, `index.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 8: Pipeline stages

Depends on Tasks 2, 3, 4, 5, 6, 7 being merged.

**Files:** `packages/pipeline/src/stages/{ingest,edit,verify,script,ground,voice,render,gate}.ts`, `packages/pipeline/src/prompts/{editor,extractor,judge,writer,entail}.ts`, `packages/pipeline/src/stages/index.ts`, `packages/pipeline/test/stages/*.test.ts`

**Interfaces:**
- Consumes: every interface produced by Tasks 2–7.
- Produces:
```ts
export interface StageDeps { client: ModelClient; meter: CostMeter; tts: TtsProvider | null; voice: string }
export function buildStages(deps: StageDeps): Stage[]     // ingest, edit, verify, script, ground, voice, render, review?, gate
export interface EditArtifact { beats: Beat[] }
export interface VerifyArtifact { claims: Claim[]; counts: Record<Verdict, number> }
export interface GroundArtifact { storyboard: Storyboard; dropped: { lineId: string; reasons: string[] }[]; kept: number }
export interface VoiceArtifact { mode: 'voiced' | 'captions'; audioPath: string | null; timings: LineTiming[]; calls: number }
export interface GateArtifact { checks: { name: string; pass: boolean; reasons: string[] }[] }
```
`buildStages` returns the stages without `review`; Task 9 exports `reviewStage(deps)` and Task 10 inserts it before `gate`.

Stage behaviour:

- **ingest.** Calls `ingest()`. `NoCheckpointsError` or an empty session list returns `final: { status: 'blocked', reason: 'no agent sessions found in this window' }`.
- **edit.** `runAgent` with role `editor` and tools over the ingest artifact:
  - `list_sessions()` → id, agent, model, start, end, entry count, commits, first user prompt cut to 200 characters.
  - `read_entries({ sessionId, from, to })` → at most 40 entries, each text cut to 600 characters.
  - `search_transcript({ query })` → up to 20 matching entries with ids.
  - `get_diff({ sha })` → paths with added and removed counts; `get_patch({ sha, path })` → the patch.

  Output schema `{ beats: Beat[] }`, at most six. After parsing, a beat is dropped if any range names an unknown session or indexes outside it. Zero beats left is an error (the runner retries).
- **verify.** For each session, the extractor (`completeJson`, role `extractor`) receives the assistant entries that end a turn (the last assistant text before each user entry and the final one), each as `{ entryId, text }`, in batches of 30. It returns `{ claims: [{ entryId, quote, kind, subject? }] }`. Claims whose quote fails `quoteMatches` are dropped. `verifyClaims` judges the four deterministic kinds. Each `implemented` claim goes to the judge (role `judge`) with the patches of the session's commits; the judge returns `{ supported: boolean, path?: string, quote?: string }`. It is `verified` only if `supported` and the quote is found in that patch; `supported: false` gives `unverifiable`, never `contradicted`.
- **script.** Code builds the frame, the model writes only narration.
  - Code creates the title scene, one flag scene per `contradicted` or `stale` claim (at most three, newest first) and the end scene. A flag scene's narration is a template, not model text: `The agent wrote: "<quote cut to 120 characters>".` plus, by reason, `The last test run before that message had failed.` / `Code was edited after the last passing run.` / the rule's `reason`. The quote and the reality sentence are two separate lines. Their evidence is the claim's evidence.
  - The writer (role `writer`) receives the beats, the verified claims, the facts and the entries each beat points to, and returns spoken scenes of types `prompt`, `terminal`, `diff`, `stats` with one-sentence lines that each cite evidence. `ctx.feedback`, when set, is appended to the prompt.
  - The writer is told to follow one arc: the problem (a `prompt` scene quoting the human's request), the key decisions, the implementation (`diff`), the recorded validation (`terminal` with the commands that were actually run), then `stats`.
  - The storyboard is assembled as title, writer scenes in that arc with each flag scene placed after the validation scene of its session, end. Target 75 s.
- **ground.** For every line run `checkLine`. A passing line then goes to the entailment check (role `judge`): given the line and the text of its evidence, reply `{ entailed: boolean }`. A failing line is rewritten by the writer with the reasons, at most twice, then dropped. A scene left with no lines is removed. Flag-scene template lines skip the model check and the style lint (`skipStyle`), but their evidence refs must still resolve. If fewer than two spoken scenes remain the stage loops back to `script` with the reasons. The whole stage runs inside `guard('grounding', …)`.
- **voice.** `voiceLines` over all lines in order with `maxCalls = run.budget.maxTtsCalls`; `tts === null` gives captions mode.
- **render.** `renderReel` into `<runDir>/reel`.
- **gate.** Inside `guard('publish_gate', …)` evaluate and record: grounding (no line without evidence in the final storyboard), secrets (`redact` over every on-screen string and line reports zero hits), cost (`meter.total() <= run.budget.maxCostPerReelUsd`), review (no high-severity finding in the review artifact; when no review stage ran, `ctx.read('review')` throws and the check is recorded as passed with the reason `review skipped`). Any failure returns `final: { status: 'blocked', reason: <failed check names> }`. All passing returns `final: { status: 'needs_approval', reason: 'awaiting human approval' }`.

After every stage that used the model, `addCost(db, run.id, delta)` records the meter's increase.

- [ ] **Step 1: Write failing tests** with `createMockClient` and a two-session fixture:

```ts
it('edit drops beats that point outside a session and retries on zero beats');
it('verify drops a claim whose quote is not in the transcript');
it('verify marks an implemented claim verified only when the judge quote is in the patch');
it('script creates one flag scene per contradicted claim with template narration and the claim evidence');
it('script never lets the writer produce a flag scene');             // writer output containing type:'flag' is discarded
it('ground drops a line after two failed rewrites and removes the empty scene');
it('ground loops back to script when fewer than two spoken scenes survive');
it('gate blocks when a secret-shaped string is on screen, and when cost exceeds the budget');
it('gate returns needs_approval when every check passes');
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** prompts and stages. Keep each prompt in its own file as an exported function returning `{ system, user }`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 9: Review stage

Depends on Tasks 3, 5, 6, 7 being merged. Parallel with Task 8.

**Files:** `packages/pipeline/src/stages/review.ts`, `packages/pipeline/src/prompts/reviewer.ts`, `packages/pipeline/test/stages/review.test.ts`

**Interfaces:**
- Consumes: `renderStills` (`@dailies/reel`), `detectSilences` (`@dailies/voice`), `completeJson` (`@dailies/agent`), `Stage`, `StageContext` (Task 7), `Finding`, `RenderArtifact` (`@dailies/core`).
- Produces: `export function reviewStage(deps: { client: ModelClient }): Stage<{ pass: boolean; findings: Finding[] }>` and the pure helper `export function durationFinding(actualSec: number, targetSec: number): Finding | null`.

Behaviour:

- Deterministic checks: `durationFinding` reports high severity when the duration is over `targetSec * 1.25` or under 20 s. `ffmpeg -i reel.mp4 -vf blackdetect=d=0.5 -an -f null -` reports high severity for any black segment after the first second. `detectSilences` on the narration with `minSec: 1.8` reports low severity per gap.
- Vision check: `renderStills`, then one `completeJson` call per batch of four stills (role `vision`) with a fixed rubric: text cut off or overflowing, empty or near-empty frame, unreadable contrast, content that does not match the scene type. Reply schema `{ findings: Finding[] }`.
- Any high-severity finding returns `loopBackTo: 'script'` with the findings joined into `reason`. Otherwise `pass: true`.

- [ ] **Step 1: Write failing tests:** `durationFinding` at the three boundaries; a mock vision reply with one high finding produces `loopBackTo: 'script'` and a reason naming the scene; a clean reply produces `pass: true`; a reel with a generated two-second black segment is reported.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 10: CLI and end-to-end

Depends on Tasks 8 and 9.

**Files:** `packages/cli/src/{index.ts,run.ts,verify.ts}`, `packages/cli/bin/{dailies,entire-dailies}`, `packages/cli/test/e2e.test.ts`, `README.md`

**Interfaces:**
- Consumes: `buildStages`, `reviewStage`, `openDb`, `createRun`, `runPipeline`, `getRun`, `listEvents`; `ingest`; `createRouter`, `CostMeter`, `initTracing`, `shutdownTracing`, `completeJson`; `verifyClaims`; `createGeminiTts`; `loadEnv`, `DEFAULT_BUDGET`.
- Produces: the commands below.

```
dailies run <repo-url|path> [--since 24h|<ISO>] [--max-sessions 12] [--out <dir>] [--no-voice] [--no-review]
dailies verify <repo-url|path> [--since 24h|<ISO>] [--json]
```

- `run` creates a run, executes the pipeline, prints each event as it happens, then prints the final status, reason, cost, and the paths of the MP4, subtitles and poster. Exit code 0 for `needs_approval`, 2 for `blocked`, 1 for `failed`. The whole command runs under `initTracing(env, 'dailies-reel')` with the run id attached, and calls `shutdownTracing()` in `finally`.
- `verify` runs ingest and the verify stage only and prints a table: verdict, kind, session, quote cut to 80 characters, reason. `--json` prints the claims array.
- `--since 24h` accepts `<n>h` and `<n>d`; anything else is parsed as an ISO date.
- `bin/dailies` and `bin/entire-dailies` are identical shell shims that run `tsx <repo>/packages/cli/src/index.ts "$@"`. With `packages/cli/bin` on `PATH`, `entire dailies run .` works because the Entire CLI dispatches `entire <name>` to an executable named `entire-<name>`.

- [ ] **Step 1: Write the failing end-to-end test.** Build a fixture repo (reuse the Task 2 builder through a relative import of its test helper) with two sessions: one where the agent says tests pass after a failing run, one honest. Run the stages with `createMockClient` (scripted replies per role), `tts: null`, and the real renderer. Assert: status `needs_approval`; the storyboard has exactly one flag scene; `reel.mp4` exists and is longer than 8 s; `gate.json` lists four passing checks.
- [ ] **Step 2: Add the review-focus test:** a repo with no checkpoints makes `dailies run` exit 2 with the message `no agent sessions found in this window`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement** the CLI.
- [ ] **Step 5: Run.** Expected: PASS. Then `pnpm test` and `pnpm typecheck` at the root.
- [ ] **Step 6: Real run.** `pnpm dailies run https://github.com/entireio/cli --since 30d --max-sessions 4`. Watch the reel. Record in the commit body: status, cost, duration, verdict counts, lines dropped by the grounding gate.
- [ ] **Step 7: Write `README.md`:** what it is, the quick start above, the environment table from `.env.example`, the stage diagram from the spec, and a short "Limits" section copied from spec section 12.
- [ ] **Step 8: Commit.**
