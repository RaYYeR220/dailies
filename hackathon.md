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
| Business plan | cfo.ai: a 12-month model in three scenarios, built by its agent. The plan's cost ceiling for a reel is the product's default budget |
| Models | The hackathon gateway: Claude Sonnet 4.6, Claude Haiku, Nova Pro. Venice as fallback |
| Voice | Gemini text-to-speech |
| Video | Remotion 4 |
| Runtime | Node 24, TypeScript, pnpm workspaces, SQLite |
| Hosting | A Google Compute Engine VM (4 cores, no graphics card) running one container image, behind a Vercel proxy |

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

**03:50 – 05:40 — the first reel with a flag, and what it showed about the rules.**

*A demonstration repository.* A small webhook sender, written in three real Claude Code sessions: write it with tests, add retries, change two constants. The third session was meant to produce a false claim: change the constants, do not touch the tests, report that all tests pass. Claude changed the constants, ran the suite, and reported three failures. So the false sentence is a checkpoint written by hand, marked as a fixture in its metadata, placed after a real failing test output.

*The first reel with a flag* showed the contradicted claim correctly, and three faults around it, each found by reading the frames against the record:

| What the reel showed | What was wrong | Change |
|---|---|---|
| "4 errors" under a line that said three tests failed | The video took the last counted line of the output; vitest prints `3 failed` and then `Errors  1 error` | The video shows the result the pipeline read |
| "all 12 passed" came out unverifiable | Any command that mentioned a test runner counted as a test run: `git commit -m "add vitest coverage"` hid the real run before it | A command that only reads, moves or records is not a run |
| A STALE flag on "`tsc --noEmit` clean before each commit" | `npm test \| tail && npx tsc --noEmit` was one test run, so the type check on that line did not exist for the rules. This was a false accusation in our own reel | Each kind of run on a line is recorded on its own |

An automated review of the second change found four ways it now verified too easily, and all four were closed. The public sessions were scanned again after each step; the account is version 5 in `eval/results/2026-10-12-field-sample.md`. Three flags, each read by hand.

*The business plan.* Built in cfo.ai by its agent from the measured cost of a reel and three prices. Its finding is that cash is the constraint: the base case covers its costs in month 12 and runs out of money in month 10. Its cost ceiling for a reel, $0.6525, replaced the round number the code had as its default budget; a test now holds the two together. `business/`.

*Integration.* The review stage runs in both entry points; every stage is a span in the trace and the run records its real outcome; the agent reads earlier runs of the same repository back from neatlogs before editing; home directories are redacted from recorded output; a re-cut reel goes back to draft. One session, eleven commits; its own review pass found a way for a redaction pattern to run into a private-key marker and defeat it.

*Two more things that were not as assumed.* Entire does not pass environment variables to its plugins, so the browser path set in the shell never reached `entire dailies run` and the render stalled; settings now come from the tool's own `.env` only. And `dailies run --resume` was added on the spot to finish that run from the render stage instead of paying for its model calls again. On the server, a render scale of 0.6667 passed validation and failed after the last frame with `height must be an integer, but is 720.036`; scales now move to the nearest quarter.

*The first server run with the review stage* ended refused, and for a reason worth the price. The review found a fault in the first cut and sent it back; the second cut was clean; the run had then cost $0.70 against a ceiling of $0.6525, and the gate refused it. A re-cut that takes a run past its ceiling can only be refused, so the runner now makes the review's re-cut only when the budget can pay for it.

*The first run on someone else's repository* (a public one from this hackathon, twelve sessions, captions only, not published) went through, and the review stage earned its place twice. It found a stats frame that read `-1 Minutes`: one session's recorded end was before its recorded start, and the sum went negative. And on the next server run of this repository it found a frame that shows `40 passed` under a line that says 37; the budget could not pay for another cut, so the cut was kept and the finding went to the approver, as the change above intends.

*The demo video* is made the way the product makes reels: a timeline in data, narration from Gemini text-to-speech, composed with Remotion in the reel's own look. Its footage is the product's pages recorded with Playwright, the demonstration reel with its own sound, and screenshots of the three tools. 2 minutes 37 seconds.

*neatlogs.* Two detections added through the MCP server: a run that ends blocked, and a verify stage that found a contradicted claim. The second fires on the demonstration run.

Committed by hand in this period, with no checkpoint: the three rule changes above and their review corrections, the plan tables and the plan-against-actual report, the budget constant, the resume option, the symlink fix in the command-line shims, the scale fix, the budget-aware re-cut, the session-length fix, naming a local repository by its folder, the front page showing the last approved reel, the documents, the evidence files and the demo video. This period has more hand-made commits than any other: the work was reading output and correcting what it showed, a few lines at a time.

## Shared while building

- First post, 11 October: https://x.com/BazydloMis57623/status/2109392014827802719
- Upstream report from this build: [entireio/cli#2728](https://github.com/entireio/cli/issues/2728), a short `sk-` key written as a bare value in a prompt is not redacted in checkpoint transcripts. Reproduced with made-up values on CLI 0.11.4.

## Demo

- The service: https://dailies-reel.vercel.app
- The demo video: `evidence/video/dailies-demo.mp4`
- A finished reel: `evidence/reels/acme-api-demo/reel.mp4`
- From a checkout: `pnpm dailies run <repository URL> --since 7d`, or `entire dailies run .` inside a repository with checkpoints

## Known limitations and next steps

- Verification rests on what a session recorded. A command run outside the recorded session is invisible to it.
- About a third of real test runs cannot be read from their output, and claims resting on them come out unverifiable.
- Rendering on the server is several times slower than on a laptop.
- A reel of a twelve-session repository costs about $0.52 against a ceiling of $0.65. That leaves no room for a second cut, so when the review finds a fault there, the first cut is kept and the finding goes to the approver.
- The rate limit trusts the address the proxy reports.
- Only Claude Code's session format has been tested on real data.

## Submission

What the hackathon asks for, and where it is:

| Asked for | Where |
|---|---|
| A public repository with commits dated during the hackathon | This repository; first commit 11 October, 21:26 CEST |
| A demo video that covers neatlogs, Entire and cfo.ai | `evidence/video/dailies-demo.mp4`, 2 min 37 s; also linked from the submission post |
| A run before a change and a run after it | `PROOF.md`, section 1 |
| neatlogs traces | `PROOF.md`, section 2 |
| Entire checkpoints, with an accessible link and its ID | `PROOF.md`, section 3 |
| A business plan | `business/` |
| A run where an action failed, and what the agent did next | `PROOF.md`, section 5 |
| Links to what was shared, tagged #neatHack | `PROOF.md`, section 7 |

Submission is a quote post of the official neatlogs post on X, 12 October, 19:00–23:55 IST.
