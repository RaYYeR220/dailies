# Field sample: the verification rules on real public sessions

12 October 2026. No model is involved in this measurement.

## What was measured

Every public repository found for the hackathon that exposes Entire checkpoints was ingested: 101 of 277 had them, 100 ingested, 1 had no checkpoint refs at fetch time. From each, up to 12 sessions since 9 October: 394 sessions and about 106,000 transcript entries.

In each session, statements of the form "tests pass" in the message that ends a turn were found by a text pattern and judged by the deterministic rule against the commands recorded in the same session. The pattern is crude on purpose. It is a way to put the rules in front of real sessions; the product itself extracts claims with a model and keeps only quotes that are literally in the transcript.

Script: `eval/src/field-scan.ts`. Dataset: `eval/datasets/neathack-public.json`.

## Five versions of the rules

| | Version 1 | Version 2 | Version 3 | Version 4 | Version 5 |
|---|---|---|---|---|---|
| Statements found | 422 | 423 | 423 | 423 | 418 |
| Verified | 170 | 181 | 185 | 183 | 197 |
| Unverifiable | 229 | 234 | 236 | 238 | 218 |
| Contradicted | 10 | 5 | 1 | 1 | 1 |
| Stale | 13 | 3 | 1 | 1 | 2 |
| Flags (contradicted + stale) | 23 | 8 | 2 | 2 | 3 |
| Repositories with a flag | 14 | 7 | 2 | 2 | 3 |
| Test runs read as pass / fail / unknown | 991 / 356 / 561 | 1003 / 292 / 631 | 1027 / 231 / 673 | 1015 / 231 / 685 | 1007 / 230 / 575 |

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

**Version 4 to 5.** Running the product on a small demonstration repository showed a recognition fault, not an accusation: any command that mentioned a test runner was counted as a test run. `git commit -m "add vitest coverage"`, `grep` inside `node_modules/vitest` and `npm view vitest versions` all became test runs with an unreadable result, and each one hid the real run before it, so a true "all 12 passed" came out unverifiable. A command that only reads, moves or records things is no longer a run, the body of a here-document is not read as commands, and `2>&1` is no longer taken for a background job. 111 fewer commands are counted as unreadable test runs and 14 more statements are verified.

The demonstration repository showed a second fault, and this one was a false accusation in the product's own reel. `npm test | tail && npx tsc --noEmit` was recorded as one test run, so the type check on that line did not exist for the rules, and "`tsc --noEmit` clean before each commit" was called stale because of an edit the type check had in fact followed. Each kind of run on a line is now recorded on its own, an exit status speaks only for a step it can speak for (a clean exit of an `&&` chain, for a step that is not piped), and an error on a line with several steps is not pinned on one of them unless the others cannot fail.

The same change uncovered two more flags, because runs that had been hidden were now visible. Both were read by hand. One holds and is listed below. The other was wrong: "Tests passed", said right after `gh pr checks` on a merged pull request, was about the checks on GitHub, and the local run before it had one failing test that the session itself had shown to fail without the change. A result read from CI is not a run this session recorded, so a claim made after one is now unverifiable, with that reason, instead of contradicted.

An automated review of this change objected, as it had for version 3, that it opened ways to verify too easily, and it was right on four counts. A harmless-looking command can still start a run (`echo "$(npm test)"`, `find -exec`, `git bisect run`), so those are judged by what they mention, as before. A here-document fed to a shell is commands, and is read. Silence from a type check or a linter is a pass only when the exit status is the command's own; `tsc >/dev/null; echo` proves nothing. And only a command that actually reads check results counts as reading CI, matched at the head of the command and not anywhere in it. The numbers in the last column are after these corrections; none of them changed a verdict in this sample.

## The three flags that remain

All three survive the hand check.

- A claim that all 287 tests pass. The last test run before it reported `3 failed, 1 passed`; the full run before that, `18 failed, 265 passed`. Contradicted.
- A claim of 258 passing tests. The last run did report 258 passed; two code files were edited after it and before the claim. Stale.
- A claim that tests pass at 314. The last run did report 314 passed; one source file was then edited six times and a script was added, with no run after. Stale.

## What this does and does not show

- It shows the rules no longer flag 21 of the 23 statements version 1 flagged, and flag one that version 1 could not see. Twelve of those 21 were read by hand against the recorded runs and none was a correct accusation (one was arguable). The other nine were removed by the same rule changes without being read one by one.
- Three flags are too few to state a precision. The honest reading is "no false flag left in this sample", not a rate. Version 5 is also a reminder that the sample is not closed: a change that made the rules see more produced one wrong flag before it was read.
- It says nothing about recall. Tightening the rules moved statements into `unverifiable`; some of those are real false claims the rules now decline to judge.
- About 32% of test runs are still unreadable (`unknown`), mostly because the command piped its output through `tail` or `head`, or ran several things at once.
- No repository is named here. Per-flag detail was kept out of the repository.
