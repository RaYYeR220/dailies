import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CostMeter, createNeatlogsMcp, createRouter } from '@dailies/agent';
import { DEFAULT_BUDGET, loadEnv, type Env } from '@dailies/core';
import { buildStages, type Database, type Stage, type StageDeps } from '@dailies/pipeline';
import { createGeminiTts } from '@dailies/voice';
import { getDb } from './server/db';
import { workerLoop } from './worker';

/** ingest, edit, verify, script, ground, voice, render, review, gate, with fresh model and cost-meter deps for the run about to start. */
export function makeStages(db: Database, env: Env): Stage[] {
  const meter = new CostMeter(DEFAULT_BUDGET.maxCostPerReelUsd);
  const client = createRouter(env, meter);
  const tts = env.geminiKeys.length === 0 ? null : createGeminiTts(env.geminiKeys);
  const mcp = env.neatlogsApiKey ? createNeatlogsMcp({ apiKey: env.neatlogsApiKey, url: `${env.neatlogsEndpoint}/mcp` }) : null;
  const deps: StageDeps = { db, client, meter, tts, voice: 'Charon', mcp };
  return buildStages(deps);
}

/**
 * Whether `moduleUrl` (an `import.meta.url`) and `argv1` (`process.argv[1]`) name the same file,
 * resolving symlinks and decoding the URL first — the same check `@dailies/cli`'s entry point
 * uses, duplicated rather than depended on: this file is not that package's.
 */
export function isMainModule(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = getDb();

  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());

  await workerLoop({ db, dataDir: env.dataDir, makeStages: () => makeStages(db, env), signal: controller.signal });
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main();
}
