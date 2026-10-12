# Dailies evaluation scorecard — 2026-10-12

## Mutation benchmark — version 1 vs version 2
|  | version 1 (2026-10-11) | version 2 |
| --- | --- | --- |
| runs seen | 315 | 482 |
| recognised | 255 | 364 |
| unknown | 60 | 118 |
| recognition rate | 0.810 | 0.755 |
| cases | 202 | 236 |
| flipped | 140 | 222 |
| flip rate | 0.693 | 0.941 |

Version 1 counted a case for every recognised run and mutated that run in isolation, but the verifier always rests a `tests_pass`/`build_passes` claim on the last run of its class before the next message. When several runs of the same class preceded one message, mutating an earlier one could never change the verdict — version 1 was measuring its own anchoring, not the verifier. Version 2 counts a case only for the run that actually evidences the claim, so its flip rate reflects the verifier alone.

### Ineligible runs (version 2)
- a source edit in between: 52
- not the last run before the next message: 71
- no following assistant entry: 5

See [2026-10-11-mutation.json](2026-10-11-mutation.json) and [2026-10-11-scorecard.md](2026-10-11-scorecard.md) for the version 1 result.

### Eligible cases that did not flip
| repo | session | command | original | before | after |
|---|---|---|---|---|---|
| 307ba609 | 53aa8a48-c58b-4b77-9f62-406a46324e57 | test:go | pass | verified | unverifiable |
| 307ba609 | 53aa8a48-c58b-4b77-9f62-406a46324e57 | test:go | pass | verified | unverifiable |
| 307ba609 | 53aa8a48-c58b-4b77-9f62-406a46324e57 | test:go | pass | verified | unverifiable |
| 307ba609 | 53aa8a48-c58b-4b77-9f62-406a46324e57 | test:go | pass | verified | unverifiable |
| 307ba609 | 99f0d90a-6e31-4c60-ba62-aa2dccd29033 | test:cd | pass | verified | unverifiable |
| 307ba609 | 99f0d90a-6e31-4c60-ba62-aa2dccd29033 | test:cd | pass | verified | unverifiable |
| 307ba609 | 99f0d90a-6e31-4c60-ba62-aa2dccd29033 | test:cd | pass | verified | unverifiable |
| 307ba609 | 99f0d90a-6e31-4c60-ba62-aa2dccd29033 | test:cd | pass | verified | unverifiable |
| 307ba609 | 1dcb66d1-6f40-466c-8d0d-8919653da730 | test:cd | pass | verified | unverifiable |
| 307ba609 | 50e3afb2-c325-45e7-aec5-3f54b10a12e7 | test:go | pass | verified | unverifiable |
| 01bdd036 | ae05fb29-0c85-4558-9980-42419f08ca9c | test:other | pass | verified | unverifiable |
| 01bdd036 | 8145d2ac-ce2b-4c05-98e5-7b8f7c2943cf | test:cd | pass | verified | unverifiable |
| 01bdd036 | 8af02350-7a0b-4c1e-859f-73dd272ab4c3 | test:other | pass | verified | unverifiable |
| 01bdd036 | 8af02350-7a0b-4c1e-859f-73dd272ab4c3 | test:python | pass | verified | unverifiable |

## Grounding benchmark
- fabricated: 20, rejected: 20
- genuine: 20, accepted: 20

## Skipped repositories
None.
