# For judges

## The short path

1. **The video** (2 min 38 s): [`evidence/video/dailies-demo.mp4`](evidence/video/dailies-demo.mp4), and linked from the submission post.
2. **A finished reel**, without running anything: [`evidence/reels/acme-api-demo/reel.mp4`](evidence/reels/acme-api-demo/reel.mp4). 59 seconds, one command, $0.20.
3. **The service:** https://dailies-reel.vercel.app. The reel on the front page is the demonstration reel: the same pipeline made it from the command line, and the run was copied to the server because its repository is a local one. Open it with its sources and click a narration line to see the session entry or the diff it rests on.
4. **Your own repository:** paste any public GitHub repository that has Entire checkpoints. A run takes a few minutes, most of it rendering on a small server with no graphics card. Three runs a day per address.

From a checkout, `pnpm dailies verify <repository URL> --since 7d` prints the verdicts and renders nothing.

## Where each criterion is answered

| Criterion | Where to look |
|---|---|
| The agent | [`README.md`](README.md), "What it does"; the stages in `packages/pipeline/src/stages/`; the service |
| Use of neatlogs, Entire and cfo.ai | [`PROOF.md`](PROOF.md) sections 2, 3 and 4. Each goes through architecture, implementation, runtime, reasoning and result |
| The demo video | [`evidence/video/dailies-demo.mp4`](evidence/video/dailies-demo.mp4). For each of the three tools a rail at the top left lights up as it goes through architecture, implementation, runtime, reasoning and result |
| Building in public | [`PROOF.md`](PROOF.md) section 7 and [`hackathon.md`](hackathon.md), which records the mistakes as well |
| Usefulness and originality | The first paragraph of the README, and [`eval/results/2026-10-12-field-sample.md`](eval/results/2026-10-12-field-sample.md): the rules on 394 real public sessions |

## Where each required piece of evidence is

| Asked for | In [`PROOF.md`](PROOF.md) |
|---|---|
| A run before a change and a run after it | Section 1: $1.79 and blocked, then $0.10 |
| neatlogs traces | Section 2, with trace IDs and screenshots |
| Entire checkpoints | Section 3, with a checkpoint link and its ID |
| A business plan: pricing, costs, revenue, runway | Section 4 and [`business/`](business/README.md) |
| A run where an action failed, and what the agent did next | Section 5: four of them |
| Commits dated during the hackathon | Section 6 |
| What was shared, tagged #neatHack | Section 7 |

## Four things better heard from us

- **The false claim in the demonstration is scripted.** Asked to change two constants and report that all tests pass, Claude changed them, ran the tests and reported three failures. The sentence "All 13 tests pass." is in a checkpoint written by hand and labelled as a fixture. Everything else in that reel is from real sessions.
- **The rules were wrong before they were right.** The first version flagged 23 statements in public sessions and most of those flags did not survive a hand reading. Five versions later three remain. The last version was prompted by a false accusation in our own demonstration reel.
- **Most claims come out unverifiable.** About a third of real test runs cannot be read from their recorded output, and the rules decline to judge when they cannot. The reel says nothing about those.
- **The planning session is not in this repository.** Code was written in headless Claude Code sessions, each with its checkpoint. They were steered from a separate session that is not recorded here. [`hackathon.md`](hackathon.md) says how the work was organised and lists every change made by hand.
