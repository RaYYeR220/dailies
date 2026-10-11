import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createRun, getRun } from '@dailies/pipeline';
import type { Database, Stage } from '@dailies/pipeline';
import { DEFAULT_BUDGET } from '@dailies/core';
import { workerLoop } from '../src/worker';

let db: Database;
let dataDir: string;

const runInput = {
  repoUrl: 'https://github.com/octocat/hello-world',
  since: '2026-01-01T00:00:00Z',
  until: '2026-01-02T00:00:00Z',
  budget: DEFAULT_BUDGET,
};

async function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-worker-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('workerLoop', () => {
  it('runs two queued runs one after the other and survives a failing run', async () => {
    const idA = createRun(db, runInput);
    const idB = createRun(db, runInput);
    const calls = { a: 0, b: 0 };

    const makeStages = (): Stage[] => [
      {
        name: 'ingest',
        maxAttempts: 1,
        run: async (ctx) => {
          if (ctx.run.id === idA) {
            calls.a += 1;
            throw new Error('boom');
          }
          calls.b += 1;
          return { artifact: {} };
        },
      },
    ];

    const controller = new AbortController();
    const loopPromise = workerLoop({ db, dataDir, makeStages, pollMs: 10, signal: controller.signal });

    await waitUntil(() => getRun(db, idA).status !== 'running' && getRun(db, idB).status !== 'running');
    controller.abort();
    await loopPromise;

    expect(calls).toEqual({ a: 1, b: 1 });
    expect(getRun(db, idA).status).toBe('failed');
    expect(getRun(db, idB).status).toBe('needs_approval');
  });

  it('stops promptly when aborted while idle, without ever finding work to do', async () => {
    const controller = new AbortController();
    const makeStages = (): Stage[] => {
      throw new Error('should never be called: no runs are queued');
    };

    const loopPromise = workerLoop({ db, dataDir, makeStages, pollMs: 1000, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    await expect(loopPromise).resolves.toBeUndefined();
  });
});
