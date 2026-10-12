# Dailies

Dailies turns the recorded coding-agent sessions of a repository into a short narrated video reel: what an AI agent did, how it validated the work, and where its own account of events does not match the record.

Point it at a public repository and a time window. It reads the Entire checkpoints for that window, picks out the claims the agent made about its own work ("tests pass", "the bug is fixed", "I added X"), checks each one against the recorded tool output and the commit diff, and narrates the result as a reel: the problem, the key decisions, the implementation, and the recorded validation. A claim the record contradicts is not hidden — it is shown on screen next to the agent's own words, labelled as a flag. Nothing is said in narration that a line of evidence does not support; a line that fails that check is rewritten or cut before it reaches the screen.

The output of a run is an MP4, an SRT subtitle track, a poster frame, and a gate report of what passed.

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in at least LITELLM_API_KEY

pnpm dailies run https://github.com/<owner>/<repo> --since 7d
pnpm dailies verify https://github.com/<owner>/<repo> --since 7d --json
```

Or, with `packages/cli/bin` on `PATH`:

```bash
dailies run <repo-url|path> [--since 24h|<ISO>] [--max-sessions 12] [--out <dir>] [--no-voice] [--no-review]
dailies verify <repo-url|path> [--since 24h|<ISO>] [--json]
```

`dailies run` clones the repository (or uses a local path as given), builds the reel, and prints each stage's progress as it happens, then the final status, the cost of the run, and the paths of the MP4, subtitles and poster. It exits `0` when the reel is ready for approval, `2` when the run ends early with nothing to render (for example, no agent sessions in the window), and `1` on failure.

`dailies verify` runs only ingestion and claim verification and prints a table — verdict, kind, session, a short quote, and why — without rendering anything. Pass `--json` for the raw claims.

With `packages/cli/bin` on `PATH`, the Entire CLI can also run it as a plugin: `entire dailies run .`.

## Environment

Configuration comes from a `.env` file at the Dailies repository's own root (see `.env.example`) — not the repository you point `dailies run` at, and not whatever directory you happen to run it from; no secret is ever committed. A run needs at least `LITELLM_API_KEY` — without it, both commands exit with a clear message instead of failing partway through.

| Variable | Purpose |
|---|---|
| `NEATLOGS_API_KEY` | Enables tracing for the run. Without it, tracing is a no-op. |
| `NEATLOGS_ENDPOINT` | Trace ingest endpoint. Defaults to `https://ingest.neatlogs.com`. |
| `LITELLM_API_KEY` | Key for the model gateway every model call goes through. Required. |
| `LITELLM_BASE_URL` | Gateway base URL. |
| `VENICE_API_KEY` | Fallback model provider, used when the primary gateway is unavailable. |
| `GEMINI_API_KEYS` | Comma-separated keys for narration text-to-speech. Without one, or with `--no-voice`, the reel still renders — as a captions-only cut. |

`DAILIES_DATA_DIR` (not in `.env.example`, but read the same way) sets where clones, the run database and rendered artifacts live; it defaults to `.dailies` under the Dailies repository's own root, regardless of where `dailies` is invoked from.

## How a run proceeds

```
ingest -> edit -> verify -> script -> ground -> voice -> render -> gate
```

Each stage reads the artifacts of the ones before it and writes its own; a crash resumes from the last completed stage rather than starting over. `gate` checks grounding, secrets and cost, and ends the run `needs_approval` or `blocked` with reasons. (The spec also places a `review` stage before `gate`, able to send a cut back to `script` for at most two re-cuts; this build of the CLI does not yet have a way to run it.)

## Limits

- Verification rests on what the session recorded. A command the agent ran outside the recorded session is invisible.
- `implemented` claims rely on a model's judgement, constrained by a quoted, validated hunk.
- The voice is synthetic.
- Session formats other than Claude Code's are parsed best-effort.
