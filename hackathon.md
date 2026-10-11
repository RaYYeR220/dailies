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

Things the sessions caught in their own review passes:
- The runner could mark a stage done and then lose the run's final status if the process died between the two writes. Both writes are now one transaction.
- The budget meter treated a model missing from the price table as free. It now assumes the most expensive known price.
- The grounding gate accepted the number 3 as supported by the number 31 in the evidence. Matching is now boundary-aware.
- Several verification rules returned `verified` or `contradicted` on missing evidence. They now return `unverifiable`.

**Run by hand from the main checkout (no checkpoint):**
- The agent runtime's live test against the gateway: structured output and a tool-calling loop both work; the budget meter recorded a non-zero cost.
- The read-back client against the live neatlogs endpoint. The session had guessed two tool names (`trace_context`, `analytics`); the real ones are `get_trace_context` and `get_project_analytics`. Fixed in commit `26af87f`, together with scoping the history search to reel runs.

## Demo

Not available yet.

## Known limitations and next steps

- No reel has been produced end to end yet. The pipeline stages that call the models, the review stage and the command-line tool are not built.
- No web interface and no deployment yet.
- The business plan in cfo.ai has not been started.
- Verification rests on what a session recorded. A command run outside the recorded session is invisible to it.

## Submission

Confirmed requirements (neatlogs.com/hackathon, read 11 October):
- A public repository with commits dated during the hackathon: this repository.
- A demo video of three minutes or less that covers neatlogs, Entire and cfo.ai: not made yet.
- Evidence: a run before and after a change with the numbers compared; neatlogs traces; Entire checkpoints or graph output; a cfo.ai business plan; a run where an action failed and what the agent did next; links to posts tagged #neatHack. None collected yet beyond the checkpoints and traces of the build sessions.
- Entire asks for an accessible checkpoint link and its ID.
- Submission is a quote post of the official neatlogs post on X, 12 October, 19:00–23:55 IST. The final cutoff is to be announced on Discord; as of 23:00 CEST on 11 October it had not been.
