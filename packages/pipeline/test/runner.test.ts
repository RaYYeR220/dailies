import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BUDGET, BudgetExceededError } from '@dailies/core';
import { openDb, createRun, getRun, listEvents, addCost, unfinishedRuns, runPipeline, recut } from '../src/index';
import type { Database, Stage, StageName } from '../src/index';

let db: Database;
let dataDir: string;

const input = {
  repoUrl: 'https://example.com/repo.git',
  since: '2026-01-01T00:00:00Z',
  until: '2026-01-02T00:00:00Z',
  budget: DEFAULT_BUDGET,
};
const noSleep = async () => {};

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-runner-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('runPipeline', () => {
  it('runs stages in order and stores readable artifacts', async () => {
    const order: string[] = [];
    const stages: Stage[] = [
      {
        name: 'ingest',
        maxAttempts: 1,
        run: async (ctx) => {
          order.push('ingest');
          ctx.log('ingest started');
          return { artifact: { sessions: 2 } };
        },
      },
      {
        name: 'edit',
        maxAttempts: 1,
        run: async (ctx) => {
          order.push('edit');
          const ingest = ctx.read<{ sessions: number }>('ingest');
          return { artifact: { beats: ingest.sessions } };
        },
      },
    ];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('needs_approval');
    expect(order).toEqual(['ingest', 'edit']);
    const ingestArtifact = JSON.parse(readFileSync(join(dataDir, 'runs', id, 'ingest.json'), 'utf8'));
    expect(ingestArtifact).toEqual({ sessions: 2 });
    const editArtifact = JSON.parse(readFileSync(join(dataDir, 'runs', id, 'edit.json'), 'utf8'));
    expect(editArtifact).toEqual({ beats: 2 });
    const events = listEvents(db, id);
    expect(events.map((e) => e.message)).toContain('ingest started');
    expect(events[0]!.stage).toBe('ingest');
  });

  it('retries a failing stage and succeeds on the second attempt', async () => {
    let attempts = 0;
    const stages: Stage[] = [
      {
        name: 'ingest',
        maxAttempts: 2,
        run: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('transient');
          return { artifact: { ok: true } };
        },
      },
    ];
    const sleeps: number[] = [];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: async (ms) => { sleeps.push(ms); } });

    expect(status).toBe('needs_approval');
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1000]); // 500 * 2^1
  });

  it('marks the run failed after maxAttempts', async () => {
    let attempts = 0;
    const stages: Stage[] = [
      {
        name: 'ingest',
        maxAttempts: 2,
        run: async () => {
          attempts += 1;
          throw new Error('boom');
        },
      },
    ];
    const sleeps: number[] = [];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: async (ms) => { sleeps.push(ms); } });

    expect(status).toBe('failed');
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1000]);
    const run = getRun(db, id);
    expect(run.status).toBe('failed');
    expect(run.reason).toBe('boom');
  });

  it('resumes after a crash without re-running completed stages', async () => {
    const calls = { a: 0, b: 0 };
    const a: Stage = { name: 'ingest', maxAttempts: 1, run: async () => { calls.a += 1; return { artifact: 1 }; } };
    let crash = true;
    const b: Stage = {
      name: 'edit',
      maxAttempts: 1,
      run: async () => {
        calls.b += 1;
        if (crash) throw new Error('boom');
        return { artifact: 2 };
      },
    };
    const id = createRun(db, input);
    const opts = { dataDir, sleep: noSleep };
    expect(await runPipeline(db, id, [a, b], opts)).toBe('failed');
    db.prepare("UPDATE runs SET status='running' WHERE id=?").run(id);
    db.prepare("UPDATE stages SET status='pending', attempt=0 WHERE run_id=? AND name='edit'").run(id);
    crash = false;
    expect(await runPipeline(db, id, [a, b], opts)).toBe('needs_approval');
    expect(calls).toEqual({ a: 1, b: 2 });
  });

  it('loops back at most twice, then blocks with the reason', async () => {
    let scriptCalls = 0;
    let groundCalls = 0;
    const stages: Stage[] = [
      { name: 'script', maxAttempts: 1, run: async () => { scriptCalls += 1; return { artifact: { ok: true } }; } },
      {
        name: 'ground',
        maxAttempts: 1,
        run: async () => {
          groundCalls += 1;
          return { artifact: { ok: false }, loopBackTo: 'script', reason: 'not enough evidence' };
        },
      },
    ];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('blocked');
    expect(scriptCalls).toBe(3);
    expect(groundCalls).toBe(3);
    const run = getRun(db, id);
    expect(run.loops).toBe(2);
    expect(run.reason).toBe('not enough evidence');
  });

  it('passes the loop-back reason to the stage as ctx.feedback', async () => {
    const scriptFeedback: (string | null)[] = [];
    let groundCalls = 0;
    const stages: Stage[] = [
      { name: 'script', maxAttempts: 1, run: async (ctx) => { scriptFeedback.push(ctx.feedback); return { artifact: {} }; } },
      {
        name: 'ground',
        maxAttempts: 1,
        run: async () => {
          groundCalls += 1;
          if (groundCalls === 1) return { artifact: {}, loopBackTo: 'script', reason: 'rewrite line 2' };
          return { artifact: { pass: true } };
        },
      },
    ];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('needs_approval');
    expect(scriptFeedback).toEqual([null, 'rewrite line 2']);
  });

  it('ends blocked with reason budget on BudgetExceededError', async () => {
    const stages: Stage[] = [
      { name: 'edit', maxAttempts: 5, run: async () => { throw new BudgetExceededError(0.7, 0.6); } },
    ];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('blocked');
    const run = getRun(db, id);
    expect(run.reason).toBe('budget');
  });

  it('honours a final status returned by a stage', async () => {
    let gateCalls = 0;
    const stages: Stage[] = [
      { name: 'ingest', maxAttempts: 1, run: async () => ({ artifact: {} }) },
      {
        name: 'gate',
        maxAttempts: 1,
        run: async () => {
          gateCalls += 1;
          return { artifact: { checks: [] }, final: { status: 'blocked', reason: 'secrets found' } };
        },
      },
    ];
    const id = createRun(db, input);
    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('blocked');
    expect(gateCalls).toBe(1);
    const run = getRun(db, id);
    expect(run.reason).toBe('secrets found');
  });

  it('calling runPipeline again on an already-terminal run returns its status without re-running stages', async () => {
    let gateCalls = 0;
    const stages: Stage[] = [
      {
        name: 'gate',
        maxAttempts: 1,
        run: async () => {
          gateCalls += 1;
          return { artifact: {}, final: { status: 'blocked', reason: 'secrets found' } };
        },
      },
    ];
    const id = createRun(db, input);
    await runPipeline(db, id, stages, { dataDir, sleep: noSleep });
    expect(gateCalls).toBe(1);

    const status = await runPipeline(db, id, stages, { dataDir, sleep: noSleep });

    expect(status).toBe('blocked');
    expect(gateCalls).toBe(1);
  });
});

describe('store', () => {
  it('addCost accumulates onto the run record', () => {
    const id = createRun(db, input);
    addCost(db, id, 0.12);
    addCost(db, id, 0.08);
    expect(getRun(db, id).costUsd).toBeCloseTo(0.2, 10);
  });

  it('unfinishedRuns lists only runs still running', async () => {
    const running = createRun(db, input);
    const finished = createRun(db, input);
    await runPipeline(db, finished, [{ name: 'ingest', maxAttempts: 1, run: async () => ({ artifact: {} }) }], {
      dataDir,
      sleep: noSleep,
    });

    const ids = unfinishedRuns(db);
    expect(ids).toContain(running);
    expect(ids).not.toContain(finished);
  });
});

const ALL_STAGE_NAMES: StageName[] = [
  'ingest',
  'edit',
  'verify',
  'script',
  'ground',
  'voice',
  'render',
  'review',
  'gate',
];

function stubStages(calls: Record<string, number>): Stage[] {
  return ALL_STAGE_NAMES.map((name) => ({
    name,
    maxAttempts: 1,
    run: async () => {
      calls[name] = (calls[name] ?? 0) + 1;
      return { artifact: { name } };
    },
  }));
}

describe('recut', () => {
  it('throws when the run never completed verify', async () => {
    const id = createRun(db, input);

    expect(() => recut(db, id, 'make it punchier')).toThrow(/verify/);
  });

  it('resets script and every later stage and passes the feedback to the next script stage', async () => {
    const calls: Record<string, number> = {};
    const id = createRun(db, input);
    const firstStatus = await runPipeline(db, id, stubStages(calls), { dataDir, sleep: noSleep });
    expect(firstStatus).toBe('needs_approval');
    expect(calls).toEqual({
      ingest: 1,
      edit: 1,
      verify: 1,
      script: 1,
      ground: 1,
      voice: 1,
      render: 1,
      review: 1,
      gate: 1,
    });

    recut(db, id, 'make it punchier');

    expect(getRun(db, id).status).toBe('running');
    const rows = db
      .prepare('SELECT name, status, attempt FROM stages WHERE run_id = ?')
      .all(id) as { name: string; status: string; attempt: number }[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('ingest')).toMatchObject({ status: 'done' });
    expect(byName.get('edit')).toMatchObject({ status: 'done' });
    expect(byName.get('verify')).toMatchObject({ status: 'done' });
    for (const name of ['script', 'ground', 'voice', 'render', 'review', 'gate']) {
      expect(byName.get(name)).toMatchObject({ status: 'pending', attempt: 0 });
    }

    const scriptFeedback: (string | null)[] = [];
    const secondStages = stubStages(calls);
    const scriptStage = secondStages.find((s) => s.name === 'script')!;
    scriptStage.run = async (ctx) => {
      calls.script = (calls.script ?? 0) + 1;
      scriptFeedback.push(ctx.feedback);
      return { artifact: { name: 'script' } };
    };
    const secondStatus = await runPipeline(db, id, secondStages, { dataDir, sleep: noSleep });

    expect(secondStatus).toBe('needs_approval');
    expect(scriptFeedback).toEqual(['make it punchier']);
    expect(calls).toEqual({
      ingest: 1,
      edit: 1,
      verify: 1,
      script: 2,
      ground: 2,
      voice: 2,
      render: 2,
      review: 2,
      gate: 2,
    });
  });
});
