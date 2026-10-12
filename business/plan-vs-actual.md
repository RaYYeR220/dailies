# Plan against actual

Generated 2026-10-12 07:28 UTC by `eval/src/plan-vs-actual.ts` from the run rows in `business/runs-laptop.json` and `business/runs-server.json`. Every run on either machine is listed, including the ones made while the pipeline was still being built; nothing is left out.

| | Plan | Actual |
|---|---|---|
| Cost of one reel | $0.59 | $0.42 mean, $0.51 median, over 9 reels |
| Ceiling for a 55% margin on Solo | $0.6525 | 1 of 9 reels cost more |
| Gross margin on Solo (20 reels for $29) | 59.3% | 71.3% at the mean cost |

## Runs

| Run | Repository | Sessions | Reel | Cost | Against the ceiling | Outcome |
|---|---|---|---|---|---|---|
| `run_65d0c3e3429a` | RaYYeR220/dailies | 0 | none | $0.000 |  | blocked: no agent sessions found in this window |
| `run_09dd4040d76f` | RaYYeR220/dailies | 12 | none | $2.20 |  | no reel; last stage done: render |
| `run_95ebd6104a1e` | RaYYeR220/dailies | 12 | none | $0.10 |  | no reel; last stage done: edit |
| `run_34f2d0512753` | RaYYeR220/dailies | 12 | none | $0.60 |  | no reel; last stage done: ground |
| `run_93b5533e0440` | RaYYeR220/dailies | 12 | 78 s | $0.54 | 82.4% of it | passed the gate, awaiting approval |
| `run_61884dc45d03` | RaYYeR220/dailies | 12 | 66 s | $0.51 | 78.3% of it | passed the gate, awaiting approval |
| `run_4ef8188a2cd2` | acme-api-demo | 4 | 97 s | $0.22 | 33.4% of it | passed the gate, awaiting approval |
| `run_3a06918cb956` | acme-api-demo | 4 | 75 s | $0.25 | 39.0% of it | passed the gate, awaiting approval |
| `run_d11ca83125b4` | acme-api-demo | 4 | 59 s | $0.20 | 31.2% of it | passed the gate, awaiting approval |
| `run_76fbb02bc391` | RaYYeR220/dailies | 12 | 71 s | $0.70 | over by $0.049 | refused at the gate: over the ceiling |
| `run_ddc0645c6ad0` | a public repository | 12 | 36 s | $0.52 | 79.2% of it | passed the gate, awaiting approval |
| `run_205eb7784f22` | RaYYeR220/dailies | 12 | 80 s | $0.58 | 88.5% of it | passed the gate, awaiting approval |
| `run_c30fd5c61386` | RaYYeR220/acme-api-demo | 4 | 87 s | $0.23 | 34.7% of it | passed the gate, awaiting approval |

Notes:

- `run_09dd4040d76f` is the before run of `PROOF.md`, section 1. It was stopped by its budget at $1.79 in the edit stage, and later resumed to check that a stopped run can go on; the cost here is both.
- The runs with no reel were made while the stages after them were still being built.
