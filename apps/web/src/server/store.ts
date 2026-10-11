import type { Database } from '@dailies/pipeline/runtime';

export interface ReelRow {
  runId: string;
  status: 'draft' | 'approved';
  approvedAt: string | null;
}

export function ensureWebTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reels (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, approved_at TEXT);
    CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts TEXT NOT NULL, text TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS run_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts TEXT NOT NULL);
  `);
}

export function getReel(db: Database, runId: string): ReelRow | null {
  const row = db
    .prepare('SELECT run_id as runId, status, approved_at as approvedAt FROM reels WHERE run_id = ?')
    .get(runId) as ReelRow | undefined;
  return row ?? null;
}

export function approveReel(db: Database, runId: string): void {
  const approvedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO reels (run_id, status, approved_at) VALUES (?, 'approved', ?)
     ON CONFLICT(run_id) DO UPDATE SET status = 'approved', approved_at = excluded.approved_at`,
  ).run(runId, approvedAt);
}

export function addFeedback(db: Database, runId: string, text: string): void {
  db.prepare('INSERT INTO feedback (run_id, ts, text) VALUES (?, ?, ?)').run(runId, new Date().toISOString(), text);
}

export function listApproved(db: Database, limit: number): { runId: string; repoUrl: string; approvedAt: string }[] {
  return db
    .prepare(
      `SELECT r.run_id as runId, ru.repo_url as repoUrl, r.approved_at as approvedAt
       FROM reels r JOIN runs ru ON ru.id = r.run_id
       WHERE r.status = 'approved'
       ORDER BY r.approved_at DESC
       LIMIT ?`,
    )
    .all(limit) as { runId: string; repoUrl: string; approvedAt: string }[];
}

export function allowRun(
  db: Database,
  ip: string,
  now: Date,
  limits: { perIpPerDay: number; globalPerDay: number },
): { ok: boolean; reason?: string } {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { n: ipCount } = db
    .prepare('SELECT COUNT(*) as n FROM run_requests WHERE ip = ? AND ts >= ?')
    .get(ip, since) as { n: number };
  if (ipCount >= limits.perIpPerDay) return { ok: false, reason: 'rate_limited_ip' };

  const { n: globalCount } = db.prepare('SELECT COUNT(*) as n FROM run_requests WHERE ts >= ?').get(since) as {
    n: number;
  };
  if (globalCount >= limits.globalPerDay) return { ok: false, reason: 'rate_limited_global' };

  db.prepare('INSERT INTO run_requests (ip, ts) VALUES (?, ?)').run(ip, now.toISOString());
  return { ok: true };
}
