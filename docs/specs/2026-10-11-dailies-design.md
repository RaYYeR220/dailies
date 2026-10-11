# Dailies — design spec

Date: 2026-10-11 · Status: draft for review

## 1. Purpose

People who run coding agents unattended do not read the transcripts afterwards. They are megabytes long, and the agent's own summary ("fixed and tested") is the only thing anyone looks at.

**Dailies** reads a repository's Entire checkpoints (the recorded coding-agent sessions behind each commit) and produces a 60–90 second narrated video reel of what the agents did. Before it says anything, it checks the agents' claims against the diff and against the tool output recorded in the same session. A claim that the record contradicts becomes an on-screen flag. A sentence the narrator cannot back with evidence is not spoken.

The human does two things: gives feedback on a reel and approves publishing it.

### Who it is for
- A developer or founder who lets coding agents work overnight and wants a trustworthy two-minute review in the morning.
- A reviewer facing agent-written pull requests.
- Anyone building in public who wants a shareable clip of real work rather than a hand-made demo.

### Success criteria
1. Given a public GitHub repo with Entire checkpoints, a run finishes without human help and yields an MP4, subtitles, and an evidence page.
2. Every narration sentence links to at least one resolvable piece of evidence. The grounding gate enforces this in code.
3. On the mutation benchmark (section 9) every flipped test result flips the verdict.
4. A run that fails mid-way resumes from the last completed stage after a restart.
5. Nothing is published without passing all gates and an explicit human approval.

## 2. Scope

**Tier 1 — core**
Ingest, editor, claim verification from the session record and diff, grounded script, voice, data-driven scenes, render, durable runner, CLI.

**Tier 2 — product**
Web app (run view, reel page with evidence panel, inbox, gallery, landing), self-review loop, neatlogs runtime read-back and detections, budget gate from the business plan, evaluation harness and scorecard, deployment.

**Tier 3 — reach**
Request-versus-change check (requirements in the prompt that the committed change does not address), Entire CLI plugin packaging, live UI capture with Playwright, dependency-graph scene, re-running tests in a sandbox, MCP server, GitHub Action, nightly schedule.

**Not in scope**
Private repositories and GitHub App auth. Agents other than those Entire records. Auto-posting to social networks (the app drafts, a human posts). Editing the user's code.

## 3. Architecture

One TypeScript monorepo (pnpm workspaces), one Docker image that runs both the web app and the worker, one SQLite database and one data directory on a volume.

```
apps/web           Next.js: landing, app UI, API routes, SSE progress stream
packages/core      shared types and zod schemas, ids, config, budget, redaction
packages/ingest    git + Entire checkpoint reader -> normalized sessions
packages/agent     model router, agent loop, tools, tracing and steering wiring
packages/verify    claim extraction, verifiers, grounding gate
packages/voice     text-to-speech and timing
packages/reel      Remotion scenes, composition, render API
packages/pipeline  stages and the durable runner
packages/cli       `dailies` binary and the `entire-dailies` plugin shim
packages/capture   Playwright live-UI capture            (tier 3)
packages/mcp       MCP server                            (tier 3)
eval/              benchmarks, pinned datasets, results
business/          business plan export, budget generator, actuals
.neatroots/checks/ run checks as YAML
```

Package boundaries are chosen so that each can be built and tested on its own: every package exposes plain functions over the schemas in `packages/core` and none reaches into another's internals.

### Run lifecycle

A **run** turns (repo, time window) into a reel. It is a fixed sequence of stages. Each stage reads the artifacts of earlier stages, writes one JSON artifact (plus files) and is idempotent.

```
ingest -> edit -> verify -> script -> ground -> voice -> footage -> render -> review -> gate -> publish
                                ^                                              |
                                +---------- re-cut (at most 2 loops) ----------+
```

The runner records every stage attempt in SQLite (status, attempt number, timings, artifact path, error). On process start it resumes unfinished runs from their last completed stage. Each stage has its own retry policy with backoff. `review` may send the run back to `script`, `voice` or `render`. `gate` ends in `needs_approval`, `blocked` (with reasons) or `approved`; `publish` only runs from `approved`.

### Data model

| Table | Holds |
|---|---|
| `repos` | URL, default branch, last checkpoint covered, stored preferences |
| `runs` | repo, window, status, cost so far, budget, trace id |
| `stages` | run, name, status, attempt, timings, artifact path, error |
| `claims` | run, session, quote, kind, verdict, evidence refs |
| `lines` | run, scene, narration text, evidence refs, audio path, duration |
| `reels` | run, video path, subtitles, poster, status (draft / approved / published) |
| `feedback` | repo, reel, free text, resulting preference |
| `events` | run, timestamp, stage, message (drives the live progress stream) |

Artifacts (cloned repos, stage JSON, audio, frames, MP4) live under one data directory behind a small storage interface.

## 4. Stages

**4.1 Ingest (deterministic)**
Partial-clone the repo, fetch `refs/entire/*` and the legacy `entire/checkpoints/v1` branch if present. For each checkpoint read `metadata.json`, the per-session metadata, `prompt.txt` and the compact `transcript.jsonl`. Map checkpoints to commits through the `Entire-Checkpoint:` trailer. Select sessions inside the window. Redact secrets before anything else sees the text (key patterns, env assignments, high-entropy strings). Output: normalized `Session[]` with typed entries (user prompt, assistant text, tool call, tool result) and stable entry ids.

Optional enrichments through the Entire CLI when it works on the clone: `entire checkpoint explain --json`, `entire graph diff|impact`, `entire dispatch --local`. Each is reported as `used` or `skipped`; nothing is invented when one is unavailable.

**4.2 Edit (agent)**
Transcripts do not fit in context, so the editor navigates them with tools: `list_sessions`, `read_entries(session, range)`, `search_transcript(query)`, `get_diff(sha, path)`, `graph_impact(symbol)`. It returns at most six beats for the default 75-second target. A beat names its kind (feature, fix, decision, failure, recovery), the sessions and entry ranges it rests on and the commits involved.

**4.3 Verify**
Extract the claims the coding agent made, then judge each one.

Extraction: a small model reads assistant messages at turn ends and returns claims with the exact quote and the entry id. A claim is kept only if its quote is found in that entry (compared after collapsing whitespace and Markdown marks).

| Claim kind | Evidence | Verdict rule |
|---|---|---|
| `tests_pass` | last test-runner call in the session before the claim, and its output | verified if it passed; contradicted if it failed; stale if code was edited after the last passing run; unverifiable if no run exists |
| `build_passes` | same for build, type-check and lint commands | same |
| `ran_command` | a matching tool call and its result | verified if it succeeded; contradicted if it errored; unverifiable if no matching call is recorded |
| `fixed_error` | the error text in an earlier tool result and a later run of the same command without it | unverifiable when no later run exists |
| `implemented` | the diff of the linked commits | a second model must quote the supporting hunk; the quote is validated against the diff |

The first four are decided by deterministic parsers over the recorded tool results. Only `implemented` uses a model, from a different model family than the writer, and its quoted evidence is checked mechanically.

**4.4 Script**
The writer produces a storyboard: ordered scenes with typed props and narration lines. The reel follows one arc: the problem (the human's request), the key decisions, the implementation, and the recorded validation. Each line carries evidence refs. Contradicted and stale claims become flag scenes. Unverifiable claims are either left out or stated as unverified.

**4.5 Ground (gate, in code)**
For every line: evidence refs must resolve; every number in the sentence must appear in the facts computed for that scene; a second model must find the sentence entailed by the evidence. A failing line is rewritten up to twice, then dropped. A style lint (banned phrases, sentence length) runs here too. The on-screen text and narration are scanned again for secrets. The stage reports how many lines were dropped.

**4.6 Voice**
Gemini text-to-speech per line, cached by content hash. Measured durations drive the timeline. On failure: retry with backoff, then an alternate voice, then a captions-only cut that is labelled as such.

**4.7 Footage**
Scenes are rendered from data: title, quoted prompt, terminal replay, animated diff, stats, claim-versus-record flag, end card. Tier 3 adds a session timeline, the dependency-graph scene and a Playwright recording of the live app when the repo declares a URL.

**4.8 Render**
Remotion composes the storyboard into 1080p30 MP4, an SRT file and a poster frame.

**4.9 Review (agent)**
Deterministic checks first: total duration against target, silent gaps, black frames, per-scene text limits. Then frames from each scene go to a vision model with a fixed rubric (legibility, overflow, wrong or empty content). Findings map to fixes (shorten a line, change scene parameters, regenerate audio) and the run loops back, at most twice.

**4.10 Gate (in code)**
All must hold: grounding passed, secret scan clean, review passed, cost within budget, human approval recorded. Failure of any condition blocks publishing; there is no override path in the worker.

**4.11 Publish**
Mark the reel public, write the evidence page, draft a post for the human to send, and, on repositories the owner has authorised, comment the link on the pull request or commit.

## 5. Human loop

The reel page offers **Approve** and **Request changes** with free text. Feedback is stored as a per-repo preference and passed to the editor and writer on the next run; a re-cut reruns from `script` with the feedback attached.

## 6. Integrations

### Entire
- **Input.** Checkpoints are the product's only source of truth about what the agents did. Reading goes through plain git refs so that any public repo works without credentials.
- **Plugin.** `entire-dailies` on PATH makes `entire dailies` run the same engine locally: `entire dailies --since 24h`, `entire dailies verify` (claims table only, no video).
- **Write-back.** The reel link is attached to the pull request or commit.

### neatlogs
- **Tracing.** One trace per run. Root span is the workflow, child spans per stage, agent spans for editor, extractor, judge, writer and reviewer, tool spans per tool call, guardrail spans per gate carrying pass/fail and reasons. The run id is the session id.
- **Runtime read-back (MCP).** At run start the agent searches its earlier traces for the same repo and carries forward what failed last time. Nightly it reads project analytics into `business/actuals.json`. At boot it creates detections for gate failures, repeated render retries and dropped lines.
- **neatroots.** Runs beside the agent during development and evaluation with the checks in `.neatroots/checks/`; the editor and writer get the `check_my_work` tool through steering. Whether it also runs beside the production worker is decided after a spike; if not, the README says so.

### cfo.ai
- The business plan (pricing, cost of a reel, revenue, runway) lives in cfo.ai and is exported to `business/plan.json`.
- `pnpm budget:sync` turns the plan's price and target margin into `budget.generated.ts` (maximum cost per reel, per stage). The gate enforces it.
- `pnpm actuals:push` writes measured cost per reel from traces for the plan-versus-actual view.

### Models
OpenAI-compatible client with a router. Roles map to models: editor and writer on a Claude Sonnet model, extractor on a small Claude model, entailment and `implemented` judge on a Nova model, vision on a Claude Sonnet model. Provider order: the hackathon gateway, then Venice on rate-limit, budget or server errors. A rate limiter stays under the gateway's 60 requests per minute. A per-run meter stops the run when the budget is reached.

### Hosting
One Docker image with Node, git, the Entire CLI, Chromium and ffmpeg. Target is Fly.io or Railway with a volume; the choice is made at deploy time and nothing in the code depends on it.

## 7. Surfaces

| Route | Purpose |
|---|---|
| `/` | Landing: one claim, one call to action, a real reel playing |
| `/new` | Paste a repository URL, choose a window |
| `/r/[run]` | Live run: stages, events, cost so far |
| `/reel/[id]` | Player, evidence panel (each line and its sources), flags, cost, trace reference |
| `/inbox` | Reels waiting for approval or feedback |
| `/gallery` | Published reels |
| `/economics` | Plan versus actual cost per reel |
| `/health` | Evaluation scorecard, detections, open fixes for the agent itself |

Viewing is public. Starting a run is rate-limited per address and capped per day because every run costs money. Approving requires the owner token.

CLI: `dailies run <repo|path> [--since 24h] [--no-render] [--out dir]`, `dailies verify <repo|path>`.

## 8. Failure handling

| Failure | Response |
|---|---|
| Repo has no checkpoints | Run ends early with a clear message; nothing is rendered |
| Model rate limit or server error | Backoff, then the fallback provider |
| Budget reached mid-run | Run stops in `blocked`, partial artifacts kept |
| Text-to-speech fails | Retry, alternate voice, then captions-only cut labelled as such |
| Render crashes | Retry the stage from its inputs; storyboard and audio are reused |
| Review still failing after two loops | Run ends in `blocked` with the findings attached |
| Process restart | Unfinished runs resume from the last completed stage |
| Entire CLI enrichment unavailable | Marked `skipped`; the run continues on git data |

## 9. Evaluation

- **Mutation benchmark.** For every verified `tests_pass` or `build_passes` claim, flip the recorded tool result to a failure; the verdict must become contradicted. For every contradicted one, flip it to a pass; the verdict must become verified. This shows a green verdict is never vacuous.
- **Grounding benchmark.** Inject fabricated narration lines (wrong numbers, features absent from the diff) next to true ones. The gate must reject all fabricated lines and keep the true ones.
- **Field sample.** Run the verifier over sessions from public repositories pinned by commit. Hand-label a sample of flagged claims; the labels' hash is committed before the run. Report precision. Results are aggregate; no repository is named.
- **Baseline comparison.** The same sessions through a single-prompt summariser with no gates versus the full pipeline: unsupported statements per reel, tokens and cost.

Scorecards are committed as JSON and Markdown, failures included.

## 10. Testing

Unit tests for the parsers (checkpoint reader, test-runner output, trailer mapping), verifiers, grounding gate, redaction, budget and the runner's resume logic, written test-first. Fixture checkpoints are small synthetic trees built in the tests. One end-to-end test runs the pipeline with a mock model and a stub renderer.

## 11. Privacy and safety

Only public repositories. Redaction runs at ingest and again at the gate, and the gate fails closed. Reels about a repository are unlisted until its owner approves. Evaluation statistics about other people's repositories are published only in aggregate.

## 12. Known limits

- Verification rests on what the session recorded. A command the agent ran outside the recorded session is invisible.
- `implemented` claims rely on a model's judgement, constrained by a quoted, validated hunk.
- The voice is synthetic.
- Session formats other than Claude Code's are parsed best-effort.
