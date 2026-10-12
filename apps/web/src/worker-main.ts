import { CostMeter, createRouter, initTracing, shutdownTracing } from '@dailies/agent';
import { DEFAULT_BUDGET, loadEnv } from '@dailies/core';
import { buildStages } from '@dailies/pipeline';
import type { Stage } from '@dailies/pipeline';
import { createGeminiTts } from '@dailies/voice';
import { getDb } from './server/db';
import { workerLoop } from './worker';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = getDb();
  await initTracing(env, 'dailies-reel');

  // A fresh meter per run: the budget is per reel, and one run's spend must not count against the next.
  const makeStages = (): Stage[] => {
    const meter = new CostMeter(DEFAULT_BUDGET.maxCostPerReelUsd);
    const client = createRouter(env, meter);
    const tts = env.geminiKeys.length > 0 ? createGeminiTts(env.geminiKeys) : null;
    return buildStages({ db, client, meter, tts, voice: 'Charon' });
  };

  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());

  try {
    await workerLoop({ db, dataDir: env.dataDir, makeStages, signal: controller.signal });
  } finally {
    await shutdownTracing();
  }
}

main();
