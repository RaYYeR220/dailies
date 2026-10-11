import type { Gate, RunInfo, StageInfo } from './types';

/*
  Readers for what the API returns. The pages are given JSON that started as rows and files written by
  other processes, so every field is checked before a component touches it. No schema library here:
  this module also runs in the browser.
*/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown): string | null => (str(v) ? v : null);

const STATUSES = new Set(['running', 'needs_approval', 'blocked', 'failed']);

export function parseRun(v: unknown): RunInfo | null {
  if (!isRecord(v)) return null;
  const budget = isRecord(v.budget) ? v.budget.maxCostPerReelUsd : undefined;
  if (!str(v.id) || !str(v.repoUrl) || !str(v.since) || !str(v.until) || !str(v.createdAt)) return null;
  if (!str(v.status) || !STATUSES.has(v.status) || !num(v.costUsd) || !num(budget)) return null;
  return {
    id: v.id,
    repoUrl: v.repoUrl,
    since: v.since,
    until: v.until,
    status: v.status as RunInfo['status'],
    reason: strOrNull(v.reason),
    costUsd: v.costUsd,
    loops: num(v.loops) ? v.loops : 0,
    budgetUsd: budget,
    createdAt: v.createdAt,
  };
}

export function parseStages(v: unknown): StageInfo[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) =>
    isRecord(row) && str(row.name) && str(row.status)
      ? [{ name: row.name, status: row.status, attempt: num(row.attempt) ? row.attempt : 0, startedAt: strOrNull(row.startedAt), endedAt: strOrNull(row.endedAt), error: strOrNull(row.error) }]
      : [],
  );
}

export function parseGate(v: unknown): Gate | null {
  if (!isRecord(v) || !Array.isArray(v.checks)) return null;
  return {
    checks: v.checks.flatMap((c) =>
      isRecord(c) && str(c.name) && typeof c.pass === 'boolean'
        ? [{ name: c.name, pass: c.pass, reasons: Array.isArray(c.reasons) ? c.reasons.filter(str) : [] }]
        : [],
    ),
  };
}

/** A media address is used only when it points back at this site's media route. */
export function mediaPath(v: unknown): string | null {
  return str(v) && /^\/media\/run_[0-9a-f]+\/[a-z0-9.]+(\?k=run_[0-9a-f]+)?$/.test(v) ? v : null;
}

export { isRecord };
