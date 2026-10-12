# What is claimed, and how far each claim goes

## Works, and was run end to end

| Claim | Checked by |
|---|---|
| One command turns a repository's checkpoints into an MP4, subtitles and a poster | Runs listed in [`business/plan-vs-actual.md`](business/plan-vs-actual.md); the reel in `evidence/reels/` |
| A "tests pass" or "build is clean" claim gets its verdict from a rule in code, never from a model | `packages/verify/src/rules.ts`; 107 tests; the field sample |
| A narration line with a number, a quote or a source the record does not hold does not reach the reel | `packages/verify/src/ground.ts`; 20 of 20 fabricated lines of six kinds rejected |
| A run that dies resumes at the stage it died in, and pays for nothing twice | [`PROOF.md`](PROOF.md) section 5, `run_3a06918cb956` |
| A run cannot spend more than the plan's cost ceiling | The meter, the stage shares and the gate; the before run in [`PROOF.md`](PROOF.md) section 1 was stopped by it |
| The agent reads its own earlier runs back from neatlogs | `[edit] memory: …` in a run's log; `packages/pipeline/src/memory.ts` |
| The same pipeline runs behind a web page | https://dailies-reel.vercel.app |
| It works on a repository that is not ours | One public repository from this hackathon, twelve sessions, end to end from the command line for $0.52; the reel was not published |

## Works, with a limit worth knowing

| Claim | Limit |
|---|---|
| A narration line is true to its evidence | The code gate checks numbers, quotes and sources. A line that twists the meaning without touching those is left to a model check and to the review stage |
| Claims are found in the transcript | A model finds them. Code keeps only those whose quote is literally in the transcript, so a made-up claim is dropped, but a real one can be missed |
| "I implemented X" is checked against the diff | By a model, held to one quoted line that code then searches for in the patch. Weaker than the rules |
| The review stage sends a bad cut back | It did in one recorded run ([`PROOF.md`](PROOF.md) section 5). It does so only when the budget can pay for another cut; otherwise the first cut is kept and the finding goes to the approver |
| The service takes any public repository | Twelve sessions at most per run, three runs a day per address, forty a day in total. Rendering is slow on the server |
| Other agents' sessions | Parsed as well as they can be. Only Claude Code's format was tested on real data |

## Not claimed

- That a flag means an agent lied. A flag means the record contradicts the sentence. The reel shows both and leaves the judgement to the viewer.
- That no flag means the work is good. `unverifiable` is the most common verdict.
- A precision figure. Three flags on 394 sessions, all read by hand, is "no false flag left in this sample" and nothing more.
- Recall. Nothing here measures how many false claims the rules miss.
- That the rate limit is hard. The service trusts the address its proxy reports; someone who reaches the server directly can pose as many addresses, and only the daily total stops them.
