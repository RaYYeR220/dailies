import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Budget } from '@dailies/core';
import { newId } from '@dailies/core';
import type { Database, RunRecord, RunStatus } from './types';

interface RunRow {
  id: string;
  repo_url: string;
  since: string;
  until: string;
  status: RunStatus;
  reason: string | null;
  cost_usd: number;
  loops: number;
  budget: string;
  created_at: string;
}

function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    repoUrl: row.repo_url,
    since: row.since,
    until: row.until,
    status: row.status,
    reason: row.reason,
    costUsd: row.cost_usd,
    loops: row.loops,
    budget: JSON.parse(row.budget) as Budget,
    createdAt: row.created_at,
  };
}

export function createRun(db: Database, i: { repoUrl: string; since: string; until: string; budget: Budget }): string {
  const id = newId('run');
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO runs (id, repo_url, since, until, status, reason, cost_usd, loops, budget, created_at)
     VALUES (?, ?, ?, ?, 'running', NULL, 0, 0, ?, ?)`,
  ).run(id, i.repoUrl, i.since, i.until, JSON.stringify(i.budget), createdAt);
  return id;
}

export function getRun(db: Database, id: string): RunRecord {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!row) throw new Error(`run not found: ${id}`);
  return toRunRecord(row);
}

export function listEvents(
  db: Database,
  runId: string,
  afterId = 0,
): { id: number; ts: string; stage: string | null; message: string }[] {
  return db
    .prepare('SELECT id, ts, stage, message FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC')
    .all(runId, afterId) as { id: number; ts: string; stage: string | null; message: string }[];
}

export function addCost(db: Database, runId: string, usd: number): void {
  db.prepare('UPDATE runs SET cost_usd = cost_usd + ? WHERE id = ?').run(usd, runId);
}

export function unfinishedRuns(db: Database): string[] {
  return (db.prepare("SELECT id FROM runs WHERE status = 'running'").all() as { id: string }[]).map((r) => r.id);
}

export function appendEvent(db: Database, runId: string, stage: string | null, message: string): void {
  db.prepare('INSERT INTO events (run_id, ts, stage, message) VALUES (?, ?, ?, ?)').run(
    runId,
    new Date().toISOString(),
    stage,
    message,
  );
}

export function setRunFinal(db: Database, runId: string, status: RunStatus, reason: string | null): void {
  db.prepare('UPDATE runs SET status = ?, reason = ? WHERE id = ?').run(status, reason, runId);
}

export function incrementLoops(db: Database, runId: string): void {
  db.prepare('UPDATE runs SET loops = loops + 1 WHERE id = ?').run(runId);
}

interface StageRow {
  status: string;
  attempt: number;
}

export function getStageRow(db: Database, runId: string, name: string): StageRow | undefined {
  return db.prepare('SELECT status, attempt FROM stages WHERE run_id = ? AND name = ?').get(runId, name) as
    | StageRow
    | undefined;
}

export function isStageDone(db: Database, runId: string, name: string): boolean {
  return getStageRow(db, runId, name)?.status === 'done';
}

export function beginStageAttempt(db: Database, runId: string, name: string): number {
  const attempt = (getStageRow(db, runId, name)?.attempt ?? 0) + 1;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO stages (run_id, name, status, attempt, started_at, ended_at, error)
     VALUES (?, ?, 'running', ?, ?, NULL, NULL)
     ON CONFLICT(run_id, name) DO UPDATE SET status = 'running', attempt = excluded.attempt, started_at = excluded.started_at, ended_at = NULL, error = NULL`,
  ).run(runId, name, attempt, now);
  return attempt;
}

export function markStageDone(db: Database, runId: string, name: string): void {
  db.prepare("UPDATE stages SET status = 'done', ended_at = ? WHERE run_id = ? AND name = ?").run(
    new Date().toISOString(),
    runId,
    name,
  );
}

export function markStageFailed(db: Database, runId: string, name: string, error: string): void {
  db.prepare("UPDATE stages SET status = 'failed', ended_at = ?, error = ? WHERE run_id = ? AND name = ?").run(
    new Date().toISOString(),
    error,
    runId,
    name,
  );
}

export function resetStage(db: Database, runId: string, name: string): void {
  db.prepare(
    `INSERT INTO stages (run_id, name, status, attempt, started_at, ended_at, error)
     VALUES (?, ?, 'pending', 0, NULL, NULL, NULL)
     ON CONFLICT(run_id, name) DO UPDATE SET status = 'pending', attempt = 0, started_at = NULL, ended_at = NULL, error = NULL`,
  ).run(runId, name);
}

function artifactPath(dataDir: string, runId: string, stage: string): string {
  return join(dataDir, 'runs', runId, `${stage}.json`);
}

export function writeArtifact(dataDir: string, runId: string, stage: string, artifact: unknown): void {
  const path = artifactPath(dataDir, runId, stage);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(artifact));
  renameSync(tmp, path);
}

export function readArtifact<T>(dataDir: string, runId: string, stage: string): T {
  const path = artifactPath(dataDir, runId, stage);
  if (!existsSync(path)) throw new Error(`artifact not found for stage ${stage}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
