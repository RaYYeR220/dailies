import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CostMeter, createRouter, type ModelClient } from '@dailies/agent';
import { DEFAULT_BUDGET, loadEnv, type Claim, type Env } from '@dailies/core';
import { buildStages, createRun, getRun, openDb, runPipeline, type StageDeps } from '@dailies/pipeline';
import { parseSince, sanitizeForTerminal } from './run';

export interface VerifyOverrides {
  client?: ModelClient;
  env?: Env;
  stdout?: (line: string) => void;
}

interface VerifyArgs {
  repoUrl: string;
  since?: string;
  json: boolean;
}

export const VERIFY_USAGE = 'usage: dailies verify <repo-url|path> [--since 24h|<ISO>] [--json]';

export function parseVerifyArgs(argv: string[]): VerifyArgs {
  const positional: string[] = [];
  let since: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--since') since = argv[(i += 1)];
    else if (arg === '--json') json = true;
    else positional.push(arg);
  }

  const repoUrl = positional[0];
  if (!repoUrl) throw new Error(VERIFY_USAGE);
  return { repoUrl, since, json };
}

/** A stage's own artifact, read the way the runner writes it. Null when the stage never ran. */
function readStageArtifact<T>(dataDir: string, runId: string, stage: string): T | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, 'runs', runId, `${stage}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Runs ingest and the verify stage only, through the same `buildStages` composition `run` uses — the
 * verify stage itself is not exported from `@dailies/pipeline` (only through this one way in), and
 * reusing it here avoids a second copy of claim extraction and its prompt.
 */
export async function verifyCommand(argv: string[], overrides: VerifyOverrides = {}): Promise<number> {
  const args = parseVerifyArgs(argv);
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
  const deps: StageDeps = { db, client, meter, tts: null, voice: 'Charon' };
  const stages = buildStages(deps).filter((stage) => stage.name === 'ingest' || stage.name === 'verify');

  const status = await runPipeline(db, runId, stages, { dataDir: env.dataDir });
  const run = getRun(db, runId);

  if (status === 'blocked') {
    stdout(sanitizeForTerminal(run.reason ?? 'blocked'));
    return 2;
  }
  if (status === 'failed') {
    stdout(sanitizeForTerminal(run.reason ?? 'failed'));
    return 1;
  }

  const claims = readStageArtifact<{ claims: Claim[] }>(env.dataDir, runId, 'verify')?.claims ?? [];

  if (args.json) {
    stdout(JSON.stringify(claims));
    return 0;
  }

  stdout(['verdict', 'kind', 'session', 'quote', 'reason'].join('\t'));
  for (const claim of claims) {
    const row = [claim.verdict ?? 'unverifiable', claim.kind, claim.sessionId, cut(claim.quote, 80), claim.reason ?? ''];
    stdout(row.map(sanitizeForTerminal).join('\t'));
  }
  return 0;
}
