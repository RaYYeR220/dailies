# What is claimed, and how far each claim goes

## Works, and was run end to end

| Claim | Checked by |
|---|---|
| One command turns a repository's checkpoints into an MP4, subtitles and a poster | Runs listed in [`business/plan-vs-actual.md`](business/plan-vs-actual.md); the reel in `evidence/reels/` |
| A "tests pass" or "build is clean" claim gets its verdict from a rule in code, never from a model | `packages/verify/src/rules.ts`; 107 tests; the field sample |
| A narration line the evidence does not support does not reach the reel | `packages/verify/src/ground.ts`; 20 of 20 fabricated lines rejected |
| A run that dies resumes at the stage it died in, and pays for nothing twice | [`PROOF.md`](PROOF.md) section 5, `run_3a06918cb956` |
| A run cannot spend more than the plan's cost ceiling | The meter, the stage shares and the gate; the before run in [`PROOF.md`](PROOF.md) section 1 was stopped by it |
| The agent reads its own earlier runs back from neatlogs | `[edit] memory: …` in a run's log; `packages/pipeline/src/memory.ts` |
| The same pipeline runs behind a web page | https://dailies-reel.vercel.app |

## Works, with a limit worth knowing

| Claim | Limit |
|---|---|
| Claims are found in the transcript | A model finds them. Code keeps only those whose quote is literally in the transcript, so a made-up claim is dropped, but a real one can be missed |
| "I implemented X" is checked against the diff | By a model, held to one quoted line that code then searches for in the patch. Weaker than the rules |
| The review stage sends a bad cut back | Tested, and it ran in recorded runs, but it has not yet found anything to send back in one |
| The service takes any public repository | Twelve sessions at most per run, three runs a day per address, forty a day in total. Rendering is slow on the server |
| Other agents' sessions | Parsed as well as they can be. Only Claude Code's format was tested on real data |

## Not claimed

- That a flag means an agent lied. A flag means the record contradicts the sentence. The reel shows both and leaves the judgement to the viewer.
- That no flag means the work is good. `unverifiable` is the most common verdict.
- A precision figure. Three flags on 394 sessions, all read by hand, is "no false flag left in this sample" and nothing more.
- Recall. Nothing here measures how many false claims the rules miss.
- That the rate limit is hard. The service trusts the address its proxy reports; someone who reaches the server directly can pose as many addresses, and only the daily total stops them.
