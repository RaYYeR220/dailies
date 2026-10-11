import { runPipeline, unfinishedRuns } from '@dailies/pipeline/runtime';
import type { Database, Stage } from '@dailies/pipeline/runtime';
import { beat } from './server/heartbeat';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function workerLoop(o: {
  db: Database;
  dataDir: string;
  makeStages: () => Stage[];
  pollMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const pollMs = o.pollMs ?? 2000;

  while (!o.signal?.aborted) {
    beat(o.dataDir);
    const runId = unfinishedRuns(o.db)[0];
    if (runId === undefined) {
      await sleep(pollMs, o.signal);
      continue;
    }

    const heartbeatTimer = setInterval(() => beat(o.dataDir), pollMs);
    try {
      const stages = o.makeStages();
      await runPipeline(o.db, runId, stages, { dataDir: o.dataDir });
    } catch (err) {
      console.error(`worker: run ${runId} failed unexpectedly`, err);
    } finally {
      clearInterval(heartbeatTimer);
      beat(o.dataDir);
    }
  }
}
