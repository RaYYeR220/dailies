import type SqliteDatabase from 'better-sqlite3';
import type { Budget } from '@dailies/core';

export type Database = SqliteDatabase.Database;

export type StageName = 'ingest' | 'edit' | 'verify' | 'script' | 'ground' | 'voice' | 'render' | 'review' | 'gate';
export type RunStatus = 'running' | 'needs_approval' | 'blocked' | 'failed';

export interface RunRecord {
  id: string;
  repoUrl: string;
  since: string;
  until: string;
  status: RunStatus;
  reason: string | null;
  costUsd: number;
  loops: number;
  budget: Budget;
  createdAt: string;
}

export interface StageContext {
  run: RunRecord;
  dataDir: string;
  runDir: string;
  read<T>(stage: StageName): T; // artifact of a completed stage; throws if absent
  log(message: string): void; // appends an event
  feedback: string | null; // reason passed by the last loop-back, if any
}

export interface StageResult<T> {
  artifact: T;
  loopBackTo?: StageName;
  reason?: string;
  final?: { status: 'needs_approval' | 'blocked'; reason: string };
}

export interface Stage<T = unknown> {
  name: StageName;
  maxAttempts: number;
  run(ctx: StageContext): Promise<StageResult<T>>;
}
