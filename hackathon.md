# Dailies — neatHack build log

## Project

**Dailies** turns the coding-agent sessions recorded in a repository's Entire checkpoints into a short narrated video of what the agents did, after checking the agents' own claims against the diff and against the commands recorded in the same session.

The problem: people who let coding agents work unattended do not read the transcripts afterwards. They read the agent's closing summary, and that summary is the one thing nobody verifies.

## Team

Rayyer (solo) · GitHub [RaYYeR220](https://github.com/RaYYeR220)

## Stack

| Used for | What |
|---|---|
| Input | Entire checkpoints, read through plain git refs (`refs/entire/checkpoints/*` and the `entire/checkpoints/v1` branch) |
| Building | Entire CLI 0.11.4 with the entire-graph plugin; every build session is captured as checkpoints |
| Tracing | neatlogs TypeScript SDK in the product; `@neatlogs/claude-code` hooks on the build sessions; the neatlogs MCP endpoint for run-time read-back |
| Business plan | cfo.ai (planned, not started) |
| Models | The hackathon gateway: Claude Sonnet 4.6, Claude Haiku, Nova Pro. Venice as fallback |
| Voice | Gemini text-to-speech |
| Video | Remotion 4 |
| Runtime | Node 24, TypeScript, pnpm workspaces, SQLite |
| Hosting | Google Compute Engine VM behind a Vercel proxy (planned, not created) |

## How the build is organised

Planning and orchestration happen in a separate session that is not recorded in this repository. Code is written in headless Claude Code sessions, one per task, each in its own git worktree, each captured by Entire and traced in neatlogs. Small integration fixes made while merging are committed without a checkpoint and are listed below.

Build worktrees contain no API keys. Steps that need a live key are run by hand from the main checkout and their results recorded here.

## Build log

All times CEST, 11 October 2026. The hackathon started on 10 October; this project started late.

**20:40 — start.** Read the rules and the three required tools. Chose the idea.

**21:30 — four feasibility checks, all passed.**
- neatlogs SDK 1.1.28 with the OpenAI client pointed at the hackathon gateway: the trace appeared within seconds and could be read back through the MCP endpoint (3 spans: workflow, tool, model call).
- A headless Claude Code session in an Entire-enabled repository: the commit received an `Entire-Checkpoint` trailer and the transcript landed on the checkpoint branch. 23 seconds.
- Remotion: 5 seconds of 1080p rendered in 15 seconds on this machine.
- Gemini text-to-speech: 7.8 seconds of speech in 5 seconds; pauses between sentences are detectable with `ffmpeg silencedetect`, so one call can voice a whole reel.

Finding: neatlogs reports a cost of 0 for the gateway's model aliases. The product therefore meters cost from the gateway's own per-call cost header.

**21:26 — repository set up** with Entire and neatlogs hooks for Claude Code (`scripts/dev-setup.sh`).

**23:05 — a mistake, caught before it was published.** The planning session was being captured by the Entire hooks, which Claude Code had picked up mid-session. Three documentation commits were linked to it, and its transcript, including one model-gateway key that had been pasted into the chat, was written to the local checkpoint branch. Entire's redaction had masked one key and missed the other, a short `sk-` key. A scan before the first push found it. Nothing had been pushed.

Fix: the checkpoint data and links were removed locally and the commits recreated; Entire is disabled for the main checkout only; build sessions run in worktrees that hold no keys; every push is preceded by a scan of all reachable objects for every secret value in `.env`.

**23:05 – 23:16 — Task 1, workspace and shared schemas.** One session, 649 seconds, 2 commits (checkpoints `0e8fd0d1b09e`, `10f97e73d6b4`). The session found two errors in the written plan (a type-check script that could not run, a missing re-export) and fixed plan and code together. 6 tests.

**23:17 – 23:50 — parallel sessions, one worktree each.**

| Task | Result | Tests |
|---|---|---|
| Voice (one text-to-speech call per reel, key rotation, pause alignment) | merged | 18 |
| Durable runner (resumable stages, retries, loop-back) | merged | 11 |
| Agent runtime (model router, budget meter, tool loop, tracing) | merged | 17 |
| Verification rules and grounding gate | merged | 47 |
| Read-back client for neatlogs MCP | merged | 8 |
| Ingest, reel renderer, web API | still running | |

107 tests pass on `main` at 23:50.

**00:00 – 00:20, 12 October.** Ingest merged (one session, three passes: the first implementation, then two rounds of hardening against untrusted repository content). Review stage merged. 198 tests on `main`.

First look at real data, run by hand: ingesting 12 sessions of a public repository with 89 checkpoints gave 7,868 transcript entries, 3,227 tool calls and 140 test runs, of which the parser read 88 as passing, 22 as failing and 30 as unknown. It also took 248 seconds, which is far too slow; a task to batch the git reads is running with that number as its baseline.

Things the sessions caught in their own review passes:
- The runner could mark a stage done and then lose the run's final status if the process died between the two writes. Both writes are now one transaction.
- The budget meter treated a model missing from the price table as free. It now assumes the most expensive known price.
- The grounding gate accepted the number 3 as supported by the number 31 in the evidence. Matching is now boundary-aware.
- Several verification rules returned `verified` or `contradicted` on missing evidence. They now return `unverifiable`.

**Run by hand from the main checkout (no checkpoint):**
- The agent runtime's live test against the gateway: structured output and a tool-calling loop both work; the budget meter recorded a non-zero cost.
- The read-back client against the live neatlogs endpoint. The session had guessed two tool names (`trace_context`, `analytics`); the real ones are `get_trace_context` and `get_project_analytics`. Fixed in commit `26af87f`, together with scoping the history search to reel runs.

**00:20 – 01:10 — web API and worker, deployment files, evaluation.**

- Web API and worker merged (40 tests). A container image builds on the server in 244 seconds. The first build failed on a step that pre-fetched the renderer's browser with a command that is not among the dependencies; the step was removed and the renderer now fetches its browser on first use.
- Evaluation harness merged, and its first result was wrong in an instructive way.

| Mutation benchmark on real public sessions | Version 1 | Version 2 |
|---|---|---|
| Test and build runs seen | 315 | 461 |
| Outcome recognised by the parser | 255 (81.0%) | 365 (79.2%) |
| Cases | 202 | 235 |
| Verdict flipped when the recorded result was flipped | 140 (69.3%) | 235 (100%) |

Version 1 mutated every recognised run. The verifier rests a claim on the last run before the agent's message, and real sessions often have several runs before one message, so mutating an earlier one cannot change the verdict. The session that built the harness traced the 31% to that and declined to adjust the harness after seeing the number. Version 2 creates a case only for the run the verdict actually rests on (130 runs excluded, with reasons counted), and adds a second repository. The plan had specified version 1; the mistake was in the plan. Both results are in `eval/results/`.

The grounding benchmark: 20 of 20 fabricated narration lines rejected, 20 of 20 genuine lines accepted.

Committed by hand after sessions ended early (two sessions started a long command in the background and stopped, which ends a headless session): the Docker files of the deployment task, and the benchmark run of version 2.

**01:10 – 03:50 — the first real runs, and what they broke.**

*First run on real data* (12 sessions of this repository). The edit stage alone spent $1.79 in 12 agent steps and the run was stopped by its own budget gate at $1.50. The stage was rebuilt around short per-session outlines made by code, tighter tool outputs and a cheaper model.

| Edit stage, same repository | Before | After |
|---|---|---|
| Cost | $1.79 | $0.10 |
| Agent steps | 12 | 4 |
| Time | 84 s | about 30 s |
| Run outcome | blocked: budget | reached the gate |

neatlogs traces: `51f16cf87d19e7d4ae42af05352493cc` (before), run `run_95ebd6104a1e` (after).

*First full reel.* One command, 247 seconds from URL to MP4: 12 sessions, 59 claims (15 verified, 44 unverifiable, none contradicted), 10 narration lines in one text-to-speech call, 78 seconds of video, $0.54. The gate passed grounding, secrets and cost. The review stage did not run: it was built but never exported, so nothing could call it. Being fixed.

*What reading the artifacts showed, each now fixed with a test from the real case:* `pnpm typecheck` was not recognised as a type check; a clean type check printed nothing the parser knew; a global cap on diffs left older sessions with none; five terminal scenes in a row; narration of 133 seconds against a 75-second target.

*Rendering stopped working on the build machine at about 01:45* and it took an hour to find out why. The same browser binary renders from `/tmp` and from the home directory and hangs from anywhere under `Desktop`: macOS stops delivering frames to a process in a privacy-protected folder once the screen locks. An earlier diagnosis recorded here and in the plan (the working directory) was wrong. The renderer now accepts an explicit browser path.

*Rule precision, by hand.* A scan of 394 public sessions with a crude text pattern and the deterministic rule produced 23 flags. Reading the recorded runs behind them showed most were wrong, for reasons that became four rule changes; an automated review of the third version found two more places where it verified too easily. Two flags remain and both hold. The full account, including what it does not show, is in `eval/results/2026-10-12-field-sample.md`.

*Server.* The service is up on a 4-core VM behind TLS. The first run submitted through its API sat for half an hour with every stage pending: the worker's entry point still had the placeholder written before the stages existed. Being fixed in the integration task. A 30-second reel renders in 35 seconds on a laptop and 145 seconds on the server, which has no graphics card; a task is looking for what is expensive under software rendering.

Committed by hand in this period: the web app's import of the pipeline without stages; serving the grounded storyboard instead of the draft; finding the checkpoint branch in a clone; the explicit browser path; two rule tightenings after the automated review; the second precision pass's commit (its session stopped while a test run was still in the background).

## Shared while building

- First post, 11 October: https://x.com/BazydloMis57623/status/2109392014827802719
- Upstream report from this build: [entireio/cli#2728](https://github.com/entireio/cli/issues/2728), a short `sk-` key written as a bare value in a prompt is not redacted in checkpoint transcripts. Reproduced with made-up values on CLI 0.11.4.

## Demo

The service answers at https://34-14-134-171.sslip.io but cannot complete a run yet (see above). From a checkout: `pnpm dailies run <repository URL> --since 24h`.

## Known limitations and next steps

- Reels are produced end to end from the command line. On the server the worker is not yet wired to the stages.
- The review stage exists but does not run yet.
- Rendering on the server is about four times slower than on a laptop.
- The business plan in cfo.ai has not been started.
- Verification rests on what a session recorded. A command run outside the recorded session is invisible to it.

## Submission

Confirmed requirements (neatlogs.com/hackathon, read 11 October):
- A public repository with commits dated during the hackathon: this repository.
- A demo video of three minutes or less that covers neatlogs, Entire and cfo.ai: not made yet.
- Evidence: a run before and after a change with the numbers compared; neatlogs traces; Entire checkpoints or graph output; a cfo.ai business plan; a run where an action failed and what the agent did next; links to posts tagged #neatHack. None collected yet beyond the checkpoints and traces of the build sessions.
- Entire asks for an accessible checkpoint link and its ID.
- Submission is a quote post of the official neatlogs post on X, 12 October, 19:00–23:55 IST. The final cutoff is to be announced on Discord; as of 23:00 CEST on 11 October it had not been.
