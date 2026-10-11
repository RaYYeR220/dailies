# Dailies evaluation scorecard — 2026-10-11

## Mutation benchmark — version 1 vs version 2
|  | version 1 (2026-10-11) | version 2 |
| --- | --- | --- |
| runs seen | 315 | 461 |
| recognised | 255 | 365 |
| unknown | 60 | 96 |
| recognition rate | 0.810 | 0.792 |
| cases | 202 | 235 |
| flipped | 140 | 235 |
| flip rate | 0.693 | 1.000 |

Version 1 counted a case for every recognised run and mutated that run in isolation, but the verifier always rests a `tests_pass`/`build_passes` claim on the last run of its class before the next message. When several runs of the same class preceded one message, mutating an earlier one could never change the verdict — version 1 was measuring its own anchoring, not the verifier. Version 2 counts a case only for the run that actually evidences the claim, so its flip rate reflects the verifier alone.

### Ineligible runs (version 2)
- a source edit in between: 53
- not the last run before the next message: 73
- no following assistant entry: 4

The version 1 numbers are in [2026-10-11-mutation.json](2026-10-11-mutation.json); the version 1 scorecard as first published is this file at commit `8cd2b21`.

### Eligible cases that did not flip
None.

## Grounding benchmark
- fabricated: 20, rejected: 20
- genuine: 20, accepted: 20

## Skipped repositories
None.
