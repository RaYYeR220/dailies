import type { Database, StageName } from '@dailies/pipeline/runtime';

export const STAGE_ORDER: StageName[] = [
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

export interface StageInfo {
  name: StageName;
  status: string;
  attempt: number;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

export function listStages(db: Database, runId: string): StageInfo[] {
  const rows = db
    .prepare('SELECT name, status, attempt, started_at as startedAt, ended_at as endedAt, error FROM stages WHERE run_id = ?')
    .all(runId) as StageInfo[];
  const byName = new Map(rows.map((r) => [r.name, r]));

  return STAGE_ORDER.map(
    (name) =>
      byName.get(name) ?? { name, status: 'pending', attempt: 0, startedAt: null, endedAt: null, error: null },
  );
}

export function isStageDoneWeb(db: Database, runId: string, name: StageName): boolean {
  const row = db.prepare('SELECT status FROM stages WHERE run_id = ? AND name = ?').get(runId, name) as
    | { status: string }
    | undefined;
  return row?.status === 'done';
}
