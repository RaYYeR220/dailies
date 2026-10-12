# Proof

Each item the hackathon asks for, with where it is and how to check it. Trace screenshots stand in for links because neatlogs has no public link to a trace; the trace IDs are given so the organisers can open them in the project.

Times are CEST. Run IDs are from the run database of the machine that made the run.

## 1. A run before a change and a run after it

The same input both times: twelve sessions of this repository.

| | Before | After |
|---|---|---|
| Run | `run_09dd4040d76f` | `run_95ebd6104a1e` |
| neatlogs trace | `51f16cf87d19e7d4ae42af05352493cc` | `34f6cabdbe2ca23fe35562d3030524bc` |
| Edit stage: cost | $1.79 | $0.10 |
| Edit stage: model calls | 12, Claude Sonnet 4.6 | 4, Claude Haiku |
| Edit stage: time | 84 s | 35 s |
| Context of the last model call | 86,960 tokens | 32,665 tokens |
| Outcome | `blocked`: the run's own budget stopped it | `needs_approval` |

What the trace showed: the editor read whole transcripts through its tools, and every call carried everything read so far, so the context grew from 1,792 tokens to 86,960 in twelve calls ([top of the trace](evidence/neatlogs/before-trace-top.png), [end of it](evidence/neatlogs/before-trace-end.png)). neatlogs' own "Slow LLM Response" detection marks the 31.8-second call near the end.

The change (commits `a0882e0` to `4089db6`, the main one is `155ea6e`): the editor now starts from a short outline of each session made by code, its tools return bounded excerpts, it runs on a cheaper model, and the stage has a share of the run's budget with a fallback made by code when the share is spent. [The trace after](evidence/neatlogs/after-edit-trace-end.png).

The first full reel after the change, on the same twelve sessions: 247 seconds from URL to MP4, $0.54 (`run_93b5533e0440`, trace `1738dca8f8d1354308500fcf50f9e740`).

## 2. neatlogs traces

| Trace | What it is |
|---|---|
| `fa903ba743ffd5b275c97799f3ed6b8b` | A full run on the demonstration repository, $0.20, 257 s. One trace: `run`, then a span per stage, with the model calls, tool calls and the two gates inside. [Stages](evidence/neatlogs/after-trace-stages.png), [top](evidence/neatlogs/after-trace-top.png), [the edit stage's output](evidence/neatlogs/after-trace-edit-output.png) |
| `51f16cf87d19e7d4ae42af05352493cc`, `34f6cabdbe2ca23fe35562d3030524bc` | The before and after of section 1 |
| `93c0e37b355ac201ed7b6497cb3a6626` | The run whose render failed, section 5. [Screenshot](evidence/neatlogs/failed-render-trace.png) |

How neatlogs is used, in the order the video goes through it:

- **Architecture.** A run is one trace. The runner opens a span for the run and one for every stage attempt (`packages/pipeline/src/runner.ts`); the model client and the agent's tool loop open the spans inside (`packages/agent/src/`). The grounding gate and the publish gate are guardrail spans.
- **Implementation.** The neatlogs TypeScript SDK wraps the OpenAI-compatible client that talks to the hackathon gateway. Coding sessions that built this repository are traced by the `@neatlogs/claude-code` hooks.
- **Runtime.** Before the editor starts, the agent asks the neatlogs MCP server for earlier runs of the same repository (`search_traces`) and puts what it finds into the editor's and the writer's prompts as history (`packages/pipeline/src/memory.ts`). The line `[edit] memory: 1 earlier runs, 0 with failures` in a run's log is that call.
- **Reasoning.** The before trace is the reason the edit stage was rebuilt. Without it the only fact was "the run was blocked".
- **Result.** $1.79 to $0.10 for the stage. Two detections were added to the project through the same MCP server: "Reel blocked" (a run that ends blocked) and "Claim contradicted by the record" (the verify stage found a contradicted claim). The second one fires on the demonstration run and is visible in the [stages screenshot](evidence/neatlogs/after-trace-stages.png).

One thing neatlogs gets wrong for this setup: it reports a cost of 0 for the gateway's model aliases. Dailies meters cost from the gateway's own response header instead.

## 3. Entire checkpoints

- 147 of the 210 commits on `main` carry an `Entire-Checkpoint` trailer. The others are merges and fixes made by hand while merging, each listed in [`hackathon.md`](hackathon.md).
- The repository on Entire: https://entire.io/gh/RaYYeR220/dailies
- One checkpoint, with its link and ID: https://entire.io/gh/RaYYeR220/dailies/commit/b0e7eaab9e643185b5e3032cf4980f257df1fd00 is checkpoint `633fe5de2b31`. [Screenshot](evidence/entire/commit-with-checkpoint.png).
- The checkpoint data is on the `entire/checkpoints/v1` branch of this repository.

How Entire is used:

- **Architecture.** Checkpoints are the product's input. A checkpoint holds the prompt, every tool call with its output, and the commit they led to. That is the only record in which an agent's claim and the evidence for or against it sit side by side.
- **Implementation.** `packages/ingest` reads the checkpoint branch with plain git commands: no Entire service is called and nothing is installed in the repository being read. The command-line tool also installs as an Entire plugin, so `entire dailies run .` works in any repository with checkpoints.
- **Runtime.** The demonstration run reads 5 checkpoints, 4 sessions and 57 tool calls in under a second. A scan of the public repositories of this hackathon found checkpoints in 101 of 277 and read 394 sessions.
- **Reasoning.** A claim is judged only against output recorded in the same session, by a rule in code: the last test run before the message, and any edit to a code file after it. A model is used to find claims and to check "I implemented X" against the diff; it never decides whether tests passed.
- **Result.** On the demonstration repository: 14 claims, 11 verified, 1 contradicted, 2 unverifiable. Every claim on the evidence page carries the session and entry it came from. On the 394 public sessions the rules flag three statements, and all three were read by hand: [`eval/results/2026-10-12-field-sample.md`](eval/results/2026-10-12-field-sample.md).

Found while building: a short `sk-` key written as a bare value in a prompt is not redacted in checkpoint transcripts. Reported with a reproduction as [entireio/cli#2728](https://github.com/entireio/cli/issues/2728).

`entire graph stats` on this repository, for completeness: 18 sessions, 3 graph calls, 1,018 exploration calls. The build sessions did not use the graph.

## 4. A business plan

[`business/`](business/README.md): the plan built in cfo.ai, with its tables, three scenarios, and screenshots of the page.

- **Architecture.** The plan's cost ceiling for one reel is the agent's default budget.
- **Implementation.** `PLAN_COST_CEILING_USD` in `packages/core/src/budget.ts` is $0.6525. A test reads `business/plan.json` and fails if the constant and the plan disagree, or if the plan's own arithmetic ($29 × 0.45 ÷ 20) does not give that number.
- **Runtime.** Each model call's cost is read from the gateway's response header and added to the run. The edit and verify stages each get 30% of the ceiling; a run that passes the ceiling is stopped; the publish gate refuses a finished reel that cost more.
- **Reasoning.** The plan says the constraint is cash, not margin: the base case runs out of money in month 10, and the only scenario that stays funded is the one where a reel gets cheaper.
- **Result.** [`business/plan-vs-actual.md`](business/plan-vs-actual.md): the plan assumes $0.59 a reel; recorded runs are listed there with what each cost.

## 5. A run where an action failed, and what the agent did next

**The render failed; the run was picked up where it stopped.** `run_3a06918cb956`, trace `93c0e37b355ac201ed7b6497cb3a6626`. The render stage could not get frames from its browser and the process was stopped. The trace ends with `render` in error ([screenshot](evidence/neatlogs/failed-render-trace.png)). `dailies run --resume run_3a06918cb956` started at the render stage: ingest, edit, verify, script, ground and voice were read from what they had already written, so no model call and no narration was paid for twice. The run finished: 75-second reel, review passed, gate passed, $0.25 in total, $0.20 of it spent before the failure.

**A model's output failed a check; the pipeline dropped it and went on.** In `run_d11ca83125b4` the claim extractor returned a claim whose quote is not in the transcript, and the writer returned three scenes that pointed at things the record does not hold. The log says so: `14 claims (1 dropped for a quote not in the transcript)` and `3 pieces of writer output discarded`. Neither reached the reel.

**A run spent too much; it was stopped.** Section 1, the before run: the meter stopped the run at the budget and the run ended `blocked`.

**The review found a fault and sent the cut back; then the gate refused the run for what that had cost.** `run_76fbb02bc391`, on the server, twelve sessions of this repository. The review stage read stills of the first cut (50.5 seconds), found one high-severity fault and sent the cut back to the script stage. The second cut (71.2 seconds) passed the review with nothing found. By then the run had spent $0.70 against the plan's ceiling of $0.6525, and the gate refused it: `grounding passed, secrets passed, cost failed, review passed`. Each half is the product doing what it was built to do, and together they wasted a run, because a re-cut that takes a run past its ceiling can only be refused. The runner now prices a cut from what the last one cost and makes the review's re-cut only when the budget can pay for it; otherwise it keeps the cut that exists and the gate carries the finding to the person who approves (commit `e7f47e6`).

The same input after that change, `run_205eb7784f22`: the review read eight stills of a 79.6-second cut and found that one frame shows `40 passed` while the line spoken over it says 37 tests. The log goes on: `another cut would cost about $0.21 on top of $0.58 and pass the $0.6525 ceiling: this cut is kept, and the finding goes to the person who approves`. The gate passed with the finding listed for the approver, and the run ended `needs_approval` at $0.58.

On a public repository that is not ours the review stage also caught a real fault in the product: a stats frame that read `-1 Minutes`. One session's recorded end was before its recorded start. Fixed in `packages/core/src/facts.ts`.

## 6. A public repository with commits dated during the hackathon

This repository. First commit 11 October 2026, 21:26. The hackathon ran 10 to 12 October.

## 7. What was shared while building

- 11 October: https://x.com/BazydloMis57623/status/2109392014827802719
- [entireio/cli#2728](https://github.com/entireio/cli/issues/2728)

## The demonstration repository

`acme-api-demo` is a small repository made for this demonstration: a webhook sender. It has three real Claude Code sessions (write it with tests, add retries, change two constants) and one checkpoint written by hand.

The hand-written checkpoint exists because the real agent would not produce the failure. Asked to change the constants and report that all tests pass, it changed them, ran the suite, and reported `3 failed | 10 passed`. So the false claim "All 13 tests pass." is scripted: it is a checkpoint with the agent name "Scripted fixture" and `"fixture": true` in its metadata, placed after a real failing `npm test` output. The reel of that repository is in [`evidence/reels/acme-api-demo/`](evidence/reels/acme-api-demo/), and everything in it except that one sentence comes from the real sessions.

## Benchmarks

- **Mutation.** Take real recorded test, build and type-check runs, replace the recorded result with its opposite, and check that the verdict follows. On 236 runs from two public repositories the verdict flipped for 222. The other 14 moved to `unverifiable`, none to a wrong verdict: 7 are a build on a command line shared with the tests, where an error cannot be pinned on the build; 4 come after a CI result was read; 3 are a claim whose count matches the run. Those are the three places where the rules decline to judge. [`eval/results/2026-10-12-scorecard.md`](eval/results/2026-10-12-scorecard.md); the first version of this benchmark, which measured the wrong thing, is kept next to it.
- **Grounding.** 20 of 20 fabricated narration lines rejected by the gate, 20 of 20 genuine lines accepted.
- **Field sample.** The rules on 394 public sessions, five versions, every remaining flag read by hand: [`eval/results/2026-10-12-field-sample.md`](eval/results/2026-10-12-field-sample.md).
