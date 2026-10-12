import { join } from 'node:path';
import { traced } from '@dailies/agent';
import { BudgetExceededError } from '@dailies/core';
import {
  appendEvent,
  beginStageAttempt,
  getRun,
  incrementLoops,
  isStageDone,
  markStageDone,
  markStageFailed,
  readArtifact,
  resetStage,
  setRunFinal,
  writeArtifact,
} from './store';
import type { Database, RunStatus, Stage, StageContext, StageName } from './types';

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const STAGE_ORDER: StageName[] = ['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'review', 'gate'];

function ensureRecutFeedbackTable(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS recut_feedback (run_id TEXT PRIMARY KEY, feedback TEXT NOT NULL)');
}

function readRecutFeedback(db: Database, runId: string): string | null {
  ensureRecutFeedbackTable(db);
  const row = db.prepare('SELECT feedback FROM recut_feedback WHERE run_id = ?').get(runId) as
    | { feedback: string }
    | undefined;
  return row?.feedback ?? null;
}

export function recut(db: Database, runId: string, feedback: string): void {
  if (!isStageDone(db, runId, 'verify')) {
    throw new Error(`cannot recut run ${runId}: the verify stage never completed`);
  }
  ensureRecutFeedbackTable(db);
  const scriptIndex = STAGE_ORDER.indexOf('script');
  db.transaction(() => {
    for (let i = scriptIndex; i < STAGE_ORDER.length; i++) resetStage(db, runId, STAGE_ORDER[i]!);
    db.prepare(
      `INSERT INTO recut_feedback (run_id, feedback) VALUES (?, ?)
       ON CONFLICT(run_id) DO UPDATE SET feedback = excluded.feedback`,
    ).run(runId, feedback);
    setRunFinal(db, runId, 'running', null);
  })();
}

async function executeRun(
  db: Database,
  runId: string,
  stages: Stage[],
  o: { dataDir: string; sleep: (ms: number) => Promise<void> },
): Promise<RunStatus> {
  const sleep = o.sleep;
  const runDir = join(o.dataDir, 'runs', runId);
  let feedback: string | null = readRecutFeedback(db, runId);

  let i = stages.findIndex((s) => !isStageDone(db, runId, s.name));
  if (i === -1) i = stages.length;

  while (i < stages.length) {
    const stage = stages[i]!;
    const ctx: StageContext = {
      run: getRun(db, runId),
      dataDir: o.dataDir,
      runDir,
      read: <T>(name: StageName) => readArtifact<T>(o.dataDir, runId, name),
      log: (message: string) => appendEvent(db, runId, stage.name, message),
      feedback,
    };

    const attempt = beginStageAttempt(db, runId, stage.name);
    try {
      const result = await traced('CHAIN', stage.name, () => stage.run(ctx))();
      writeArtifact(o.dataDir, runId, stage.name, result.artifact);

      if (result.final) {
        db.transaction(() => {
          markStageDone(db, runId, stage.name);
          setRunFinal(db, runId, result.final!.status, result.final!.reason);
        })();
        return result.final.status;
      }

      if (result.loopBackTo) {
        const target = stages.findIndex((s) => s.name === result.loopBackTo);
        if (target === -1) throw new Error(`loopBackTo names an unknown stage: ${result.loopBackTo}`);
        if (getRun(db, runId).loops < 2) {
          db.transaction(() => {
            markStageDone(db, runId, stage.name);
            incrementLoops(db, runId);
            for (let j = target; j < stages.length; j++) resetStage(db, runId, stages[j]!.name);
          })();
          feedback = result.reason ?? null;
          i = target;
          continue;
        }
        db.transaction(() => {
          markStageDone(db, runId, stage.name);
          setRunFinal(db, runId, 'blocked', result.reason ?? null);
        })();
        return 'blocked';
      }

      markStageDone(db, runId, stage.name);
      i += 1;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        setRunFinal(db, runId, 'blocked', 'budget');
        return 'blocked';
      }
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= stage.maxAttempts) {
        db.transaction(() => {
          markStageFailed(db, runId, stage.name, message);
          setRunFinal(db, runId, 'failed', message);
        })();
        return 'failed';
      }
      markStageFailed(db, runId, stage.name, message);
      await sleep(500 * 2 ** attempt);
    }
  }

  setRunFinal(db, runId, 'needs_approval', null);
  return 'needs_approval';
}

export async function runPipeline(
  db: Database,
  runId: string,
  stages: Stage[],
  o: { dataDir: string; sleep?: (ms: number) => Promise<void> },
): Promise<RunStatus> {
  const initial = getRun(db, runId);
  if (initial.status !== 'running') return initial.status;

  const sleep = o.sleep ?? defaultSleep;
  // The run's own span, nested under whatever span the caller already has open (the command-line tool and the
  // worker each start one per run). Each stage's CHAIN span, opened inside executeRun, nests under this one.
  // Its captured output carries what the trace previously had no way to show: a run that ends failed used to
  // look like a successful trace, because runPipeline itself never throws — it returns a status string.
  const outcome = await traced('CHAIN', 'run', async () => {
    const status = await executeRun(db, runId, stages, { dataDir: o.dataDir, sleep });
    const run = getRun(db, runId);
    return { status, reason: run.reason, costUsd: run.costUsd };
  })();
  return outcome.status;
}
