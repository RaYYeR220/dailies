# Field sample: the verification rules on real public sessions

12 October 2026. No model is involved in this measurement.

## What was measured

Every public repository found for the hackathon that exposes Entire checkpoints was ingested: 101 of 277 had them, 100 ingested, 1 had no checkpoint refs at fetch time. From each, up to 12 sessions since 9 October: 394 sessions and about 106,000 transcript entries.

In each session, statements of the form "tests pass" in the message that ends a turn were found by a text pattern and judged by the deterministic rule against the commands recorded in the same session. The pattern is crude on purpose. It is a way to put the rules in front of real sessions; the product itself extracts claims with a model and keeps only quotes that are literally in the transcript.

Script: `eval/src/field-scan.ts`. Dataset: `eval/datasets/neathack-public.json`.

## Four versions of the rules

| | Version 1 | Version 2 | Version 3 | Version 4 |
|---|---|---|---|---|
| Statements found | 422 | 423 | 423 | 423 |
| Verified | 170 | 181 | 185 | 183 |
| Unverifiable | 229 | 234 | 236 | 238 |
| Contradicted | 10 | 5 | 1 | 1 |
| Stale | 13 | 3 | 1 | 1 |
| Flags (contradicted + stale) | 23 | 8 | 2 | 2 |
| Repositories with a flag | 14 | 7 | 2 | 2 |
| Test runs read as pass / fail / unknown | 991 / 356 / 561 | 1003 / 292 / 631 | 1027 / 231 / 673 | 1015 / 231 / 685 |

Counts move slightly between versions because the scans ran an hour apart and repositories kept receiving sessions.

## What changed between versions, and why

**Version 1 to 2.** The first flags were read by hand against the recorded runs. A claim "all offline tests pass" was contradicted because the last test command had exited with an error; its output was `No module named pytest`, so no test had run. A claim "tests now pass 12/12" was stale because a YAML file and a note were written after the run. Changes: an errored command with no test summary is unknown, not a failure; only an edit to a code file makes a result stale.

**Version 2 to 3.** All eight remaining flags were labelled by hand: one clearly right, two arguable, five wrong.

| Cause | Flags | Change |
|---|---|---|
| A test-first script prints a failing summary and then a passing one; the failed count was read as the outcome | 2 | The last summary in the output decides |
| A compound command ended with git printing `Aborting`; read as failed tests | 1 | A failure needs a matched failing summary, not a word |
| Files in temp and scratch directories written after the run | 2 | Such edits do not make a result stale |
| "266 tests pass" against `1 failed, 266 passed`: the count is right, the failure unmentioned | 1 | Unverifiable, with the reason stated; not contradicted |

**Version 3 to 4.** An automated review of the version 3 change objected that it could now verify too easily. Two of its three points held. A passing last summary no longer verifies when an earlier summary in the same output failed (it may be another suite): that output is evidence for neither verdict. A folder named `temp` inside a source tree still counts as code; only operating-system temp paths are ignored.

## The two flags that remain

Both survive the hand check.

- A claim that all 287 tests pass. The last test run before it reported `3 failed, 1 passed`; the full run before that, `18 failed, 265 passed`. Contradicted.
- A claim of 258 passing tests. The last run did report 258 passed; two code files were edited after it and before the claim. Stale.

## What this does and does not show

- It shows the rules no longer flag 21 of the 23 statements version 1 flagged. Twelve of those 21 were read by hand against the recorded runs and none was a correct accusation (one was arguable). The other nine were removed by the same rule changes without being read one by one.
- Two flags are too few to state a precision. The honest reading is "no false flag left in this sample", not a rate.
- It says nothing about recall. Tightening the rules moved statements into `unverifiable`; some of those are real false claims the rules now decline to judge.
- About 36% of test runs are still unreadable (`unknown`), mostly because the command piped its output through `tail` or `head`, or ran several things at once.
- No repository is named here. Per-flag detail was kept out of the repository.
