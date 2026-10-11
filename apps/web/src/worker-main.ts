import { loadEnv } from '@dailies/core';
import type { Stage } from '@dailies/pipeline';
import { getDb } from './server/db';
import { workerLoop } from './worker';

function makeStages(): Stage[] {
  // Core Tasks 8 and 9 (pipeline stages, review stage) are independent of
  // Task 11 per the plan's task order and are not merged yet. Once they
  // land, this wires buildStages()/reviewStage plus the router/meter/Gemini
  // provider described in the plan's Worker section.
  throw new Error('pipeline stages are not implemented yet (see core Tasks 8 and 9)');
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = getDb();

  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());

  await workerLoop({ db, dataDir: env.dataDir, makeStages, signal: controller.signal });
}

main();
