import { join } from 'node:path';
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

export async function runPipeline(
  db: Database,
  runId: string,
  stages: Stage[],
  o: { dataDir: string; sleep?: (ms: number) => Promise<void> },
): Promise<RunStatus> {
  const initial = getRun(db, runId);
  if (initial.status !== 'running') return initial.status;

  const sleep = o.sleep ?? defaultSleep;
  const runDir = join(o.dataDir, 'runs', runId);
  let feedback: string | null = null;

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
      const result = await stage.run(ctx);
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
