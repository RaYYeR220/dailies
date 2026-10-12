import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CostMeter, createRouter, initTracing, shutdownTracing, traced, type ModelClient } from '@dailies/agent';
import { DEFAULT_BUDGET, loadEnv, type Env, type RenderArtifact } from '@dailies/core';
import { buildStages, createRun, getRun, listEvents, openDb, runPipeline, type StageDeps } from '@dailies/pipeline';
import { createGeminiTts, type TtsProvider } from '@dailies/voice';

const EVENT_POLL_MS = 50;

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
    else if (arg === '--max-sessions') maxSessions = Number(argv[(i += 1)]);
    else if (arg === '--out') out = argv[(i += 1)];
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

export async function runCommand(argv: string[], overrides: RunOverrides = {}): Promise<number> {
  const args = parseRunArgs(argv);
  const env = overrides.env ?? loadEnv();
  const stdout = overrides.stdout ?? ((line: string) => console.log(line));

  let client = overrides.client;
  if (!client && !env.gatewayKey) {
    console.error('LITELLM_API_KEY is not set');
    return 1;
  }

  const until = new Date();
  const since = parseSince(args.since ?? '24h', until);

  mkdirSync(env.dataDir, { recursive: true });
  const db = openDb(join(env.dataDir, 'db.sqlite'));
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
          stdout(`[${event.stage ?? 'run'}] ${event.message}`);
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
    })({ repoUrl: args.repoUrl, runId });

    const run = getRun(db, runId);
    stdout(`status: ${status}`);
    if (run.reason) stdout(`reason: ${run.reason}`);
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
