import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createRun } from '@dailies/pipeline';
import { DEFAULT_BUDGET } from '@dailies/core';
import type { Database } from '@dailies/pipeline';
import { ensureWebTables, getReel, approveReel, draftReel, addFeedback, listApproved, allowRun } from '../src/server/store';

let db: Database;
let dataDir: string;

const runInput = { repoUrl: 'https://github.com/octocat/hello-world', since: '2026-01-01T00:00:00Z', until: '2026-01-02T00:00:00Z', budget: DEFAULT_BUDGET };

beforeEach(() => {
  db = openDb(':memory:');
  ensureWebTables(db);
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-store-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ensureWebTables', () => {
  it('is idempotent and creates reels, feedback and run_requests', () => {
    ensureWebTables(db);
    ensureWebTables(db);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(['reels', 'feedback', 'run_requests']));
  });
});

describe('getReel / approveReel', () => {
  it('returns null for a run with no reel row', () => {
    const id = createRun(db, runInput);
    expect(getReel(db, id)).toBeNull();
  });

  it('approveReel upserts a row that getReel then returns as approved', () => {
    const id = createRun(db, runInput);
    approveReel(db, id);

    const reel = getReel(db, id);
    expect(reel).not.toBeNull();
    expect(reel!.runId).toBe(id);
    expect(reel!.status).toBe('approved');
    expect(typeof reel!.approvedAt).toBe('string');
  });
});

describe('draftReel', () => {
  it('sets an approved reel back to draft, clearing approvedAt', () => {
    const id = createRun(db, runInput);
    approveReel(db, id);
    expect(getReel(db, id)!.status).toBe('approved');

    draftReel(db, id);

    expect(getReel(db, id)).toEqual({ runId: id, status: 'draft', approvedAt: null });
  });

  it('is a no-op when the run has no reel row yet', () => {
    const id = createRun(db, runInput);

    draftReel(db, id);

    expect(getReel(db, id)).toBeNull();
  });
});

describe('addFeedback', () => {
  it('stores the feedback text against the run', () => {
    const id = createRun(db, runInput);
    addFeedback(db, id, 'too long, cut it down');

    const rows = db.prepare('SELECT run_id as runId, text FROM feedback WHERE run_id = ?').all(id) as {
      runId: string;
      text: string;
    }[];
    expect(rows).toEqual([{ runId: id, text: 'too long, cut it down' }]);
  });
});

describe('listApproved', () => {
  it('returns approved reels newest first, limited', () => {
    const a = createRun(db, { ...runInput, repoUrl: 'https://github.com/octocat/a' });
    const b = createRun(db, { ...runInput, repoUrl: 'https://github.com/octocat/b' });
    const c = createRun(db, { ...runInput, repoUrl: 'https://github.com/octocat/c' });

    approveReel(db, a);
    db.prepare("UPDATE reels SET approved_at = '2026-01-01T00:00:00.000Z' WHERE run_id = ?").run(a);
    approveReel(db, b);
    db.prepare("UPDATE reels SET approved_at = '2026-01-03T00:00:00.000Z' WHERE run_id = ?").run(b);
    approveReel(db, c);
    db.prepare("UPDATE reels SET approved_at = '2026-01-02T00:00:00.000Z' WHERE run_id = ?").run(c);

    const all = listApproved(db, 50);
    expect(all.map((r) => r.runId)).toEqual([b, c, a]);
    expect(all[0]).toEqual({ runId: b, repoUrl: 'https://github.com/octocat/b', approvedAt: '2026-01-03T00:00:00.000Z' });

    const limited = listApproved(db, 2);
    expect(limited.map((r) => r.runId)).toEqual([b, c]);
  });

  it('omits draft (unapproved) reels', () => {
    const id = createRun(db, runInput);
    const result = listApproved(db, 50);
    expect(result).toEqual([]);
    expect(getReel(db, id)).toBeNull();
  });
});

describe('allowRun', () => {
  const limits = { perIpPerDay: 2, globalPerDay: 3 };

  it('allows requests under both limits and records them', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    expect(allowRun(db, '1.1.1.1', now, limits)).toEqual({ ok: true });
    expect(allowRun(db, '1.1.1.1', now, limits)).toEqual({ ok: true });
  });

  it('blocks the third request from the same address within a day', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    allowRun(db, '1.1.1.1', now, limits);
    allowRun(db, '1.1.1.1', now, limits);

    expect(allowRun(db, '1.1.1.1', now, limits)).toEqual({ ok: false, reason: 'rate_limited_ip' });
  });

  it('blocks once the global per-day limit is reached even across different addresses', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');
    allowRun(db, '1.1.1.1', now, limits);
    allowRun(db, '2.2.2.2', now, limits);
    allowRun(db, '3.3.3.3', now, limits);

    expect(allowRun(db, '4.4.4.4', now, limits)).toEqual({ ok: false, reason: 'rate_limited_global' });
  });

  it('does not count a request from more than a day ago', () => {
    const yesterday = new Date('2026-04-29T23:00:00.000Z');
    const now = new Date('2026-05-01T00:00:00.000Z');
    allowRun(db, '1.1.1.1', yesterday, limits);
    allowRun(db, '1.1.1.1', yesterday, limits);

    expect(allowRun(db, '1.1.1.1', now, limits)).toEqual({ ok: true });
  });
});
