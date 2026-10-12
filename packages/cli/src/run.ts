import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostMeter, createRouter, initTracing, shutdownTracing, traced, type ModelClient } from '@dailies/agent';
import { DEFAULT_BUDGET, loadEnv, type Env, type RenderArtifact } from '@dailies/core';
import { buildStages, createRun, getRun, listEvents, openDb, runPipeline, type StageDeps } from '@dailies/pipeline';
import { createGeminiTts, type TtsProvider } from '@dailies/voice';

const EVENT_POLL_MS = 50;

// `loadEnv`'s default `cwd` is `process.cwd()`. The Entire CLI plugin flow runs `entire dailies
// run .` from inside the *target* repository being summarized, not from Dailies' own checkout,
// so a default cwd would miss Dailies' own `.env` and write `.dailies` into the wrong repository.
// The CLI always resolves its env and data directory relative to its own package instead.
export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// The same filename the web app's `getDb()` uses (apps/web/src/server/db.ts) — spec section 3
// is explicit that a deployment has one SQLite database. Sharing the name means a CLI run shows
// up to the web app (its /inbox, its read-back) when both point at the same DAILIES_DATA_DIR;
// run.ts and verify.ts are the only two places this name needs to agree.
export const DB_FILENAME = 'dailies.db';

export interface RunOverrides {
  client?: ModelClient;
  env?: Env;
  stdout?: (line: string) => void;
}

interface RunArgs {
  repoUrl: string;
  since?: string;
  maxSessions?: number;
  out?: string;
  noVoice: boolean;
  noReview: boolean;
}

export const RUN_USAGE = 'usage: dailies run <repo-url|path> [--since 24h|<ISO>] [--max-sessions N] [--out <dir>] [--no-voice] [--no-review]';

export function parseRunArgs(argv: string[]): RunArgs {
  const positional: string[] = [];
  let since: string | undefined;
  let maxSessions: number | undefined;
  let out: string | undefined;
  let noVoice = false;
  let noReview = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--since') since = argv[(i += 1)];
    else if (arg === '--max-sessions') {
      const raw = argv[(i += 1)];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--max-sessions must be a positive integer, got ${JSON.stringify(raw)}`);
      maxSessions = parsed;
    } else if (arg === '--out') out = argv[(i += 1)];
    else if (arg === '--no-voice') noVoice = true;
    else if (arg === '--no-review') noReview = true;
    else positional.push(arg);
  }

  const repoUrl = positional[0];
  if (!repoUrl) throw new Error(RUN_USAGE);
  return { repoUrl, since, maxSessions, out, noVoice, noReview };
}

/** `<n>h` and `<n>d` relative to `now`; anything else is parsed as an ISO date. */
export function parseSince(value: string, now: Date): string {
  const relative = /^(\d+)([hd])$/.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    const ms = amount * (relative[2] === 'h' ? 3_600_000 : 86_400_000);
    return new Date(now.getTime() - ms).toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid --since value: ${value}`);
  return parsed.toISOString();
}

/** A stage's own artifact, read the way the runner writes it. Null when the stage never ran. */
function readStageArtifact<T>(dataDir: string, runId: string, stage: string): T | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'runs', runId, `${stage}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}

function exitCodeFor(status: string): number {
  if (status === 'needs_approval') return 0;
  if (status === 'blocked') return 2;
  return 1;
}

// The conservative fallback: everything up to the last "@" before the first "/", for a URL
// that carries a credential but is too malformed for `new URL()` to accept at all (an invalid
// port, for instance) — a parser that rejects the URL must not be the reason a credential in it
// survives. Run unconditionally, including after a successful parse, as a second pass that does
// not depend on `URL`'s own idea of what counts as userinfo.
const USERINFO = /^([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/]*@/i;

/**
 * `url` with any userinfo removed. Stripped before a repository URL reaches tracing input — a
 * run is only ever of a public repository, but a credential pasted into the URL by mistake must
 * not be the one place that escapes ingest's own redaction and lands in a trace unredacted. A
 * string that is not a URL at all (a local path, an SCP-style `git@host:path`, which carries no
 * embedded secret) is returned unchanged.
 */
export function stripUserinfo(url: string): string {
  let cleaned = url;
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    cleaned = parsed.toString();
  } catch {
    // Not a URL `new URL()` will accept — fall through to the regex pass below rather than
    // returning the original string unexamined.
  }
  return cleaned.replace(USERINFO, '$1');
}

// Event messages, reasons and claim text ultimately derive from a third-party repository's
// commits and agent transcripts — untrusted input by design. Printed to a terminal as-is, a
// control character (an escape sequence, a stray carriage return) could spoof or hide output;
// a Unicode format or separator character (a bidi override, a zero-width joiner) could do the
// same without ever touching the C0/C1 range. `\` is escaped too, so the escaped text can always
// be told apart from a literal backslash that was already in the input.
const UNSAFE_CHARS = /\\|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
export function sanitizeForTerminal(text: string): string {
  return text.replace(UNSAFE_CHARS, (c) => (c === '\\' ? '\\\\' : `\\u{${c.codePointAt(0)!.toString(16)}}`));
}

export async function runCommand(argv: string[], overrides: RunOverrides = {}): Promise<number> {
  const args = parseRunArgs(argv);
  const env = overrides.env ?? loadEnv(REPO_ROOT);
  const stdout = overrides.stdout ?? ((line: string) => console.log(line));

  let client = overrides.client;
  if (!client && !env.gatewayKey) {
    console.error('LITELLM_API_KEY is not set');
    return 1;
  }

  const until = new Date();
  const since = parseSince(args.since ?? '24h', until);

  mkdirSync(env.dataDir, { recursive: true });
  const db = openDb(join(env.dataDir, DB_FILENAME));
  const runId = createRun(db, { repoUrl: args.repoUrl, since, until: until.toISOString(), budget: DEFAULT_BUDGET });

  const meter = new CostMeter(DEFAULT_BUDGET.maxCostPerReelUsd);
  client = client ?? createRouter(env, meter);
  const tts: TtsProvider | null = args.noVoice || env.geminiKeys.length === 0 ? null : createGeminiTts(env.geminiKeys);

  await initTracing(env, 'dailies-reel');
  try {
    const status = await traced('WORKFLOW', 'dailies-reel', async (input: { repoUrl: string; runId: string }) => {
      const deps: StageDeps = { db, client: client!, meter, tts, voice: 'Charon', maxSessions: args.maxSessions };
      // `reviewStage` is not exported from `@dailies/pipeline` (only its artifact type is), so there is no
      // way into it through the package's one allowed door. `--no-review` is accepted for the documented
      // command surface, but there is currently nothing for it to switch off: buildStages' eight stages,
      // unmodified, are what every run executes either way.
      void args.noReview;
      const stages = buildStages(deps);

      let afterId = 0;
      const flush = () => {
        for (const event of listEvents(db, input.runId, afterId)) {
          stdout(`[${sanitizeForTerminal(event.stage ?? 'run')}] ${sanitizeForTerminal(event.message)}`);
          afterId = event.id;
        }
      };
      const timer = setInterval(flush, EVENT_POLL_MS);
      try {
        return await runPipeline(db, input.runId, stages, { dataDir: env.dataDir });
      } finally {
        clearInterval(timer);
        flush();
      }
    })({ repoUrl: stripUserinfo(args.repoUrl), runId });

    const run = getRun(db, runId);
    stdout(`status: ${status}`);
    if (run.reason) stdout(`reason: ${sanitizeForTerminal(run.reason)}`);
    stdout(`cost: $${run.costUsd.toFixed(4)}`);

    const render = readStageArtifact<RenderArtifact>(env.dataDir, runId, 'render');
    if (render) {
      let { videoPath, srtPath, posterPath } = render;
      if (args.out) {
        const outDir = resolve(args.out);
        mkdirSync(outDir, { recursive: true });
        const copyInto = (src: string, name: string): string => {
          const dest = join(outDir, name);
          copyFileSync(src, dest);
          return dest;
        };
        videoPath = copyInto(videoPath, 'reel.mp4');
        srtPath = copyInto(srtPath, 'reel.srt');
        posterPath = copyInto(posterPath, 'poster.png');
      }
      stdout(`video: ${videoPath}`);
      stdout(`subtitles: ${srtPath}`);
      stdout(`poster: ${posterPath}`);
    }

    return exitCodeFor(status);
  } finally {
    await shutdownTracing();
  }
}
