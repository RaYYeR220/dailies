import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, getRun, runPipeline } from '@dailies/pipeline';
import type { Stage } from '@dailies/pipeline';
import { DEFAULT_BUDGET } from '@dailies/core';
import { getDb } from '../src/server/db';
import { approveReel, getReel } from '../src/server/store';
import { GET as getReelDetail } from '../src/app/api/reels/[id]/route';
import { GET as listReels } from '../src/app/api/reels/route';
import { POST as approveRoute } from '../src/app/api/reels/[id]/approve/route';
import { POST as feedbackRoute } from '../src/app/api/reels/[id]/feedback/route';

let dataDir: string;

const runInput = {
  repoUrl: 'https://github.com/octocat/hello-world',
  since: '2026-01-01T00:00:00Z',
  until: '2026-01-02T00:00:00Z',
  budget: DEFAULT_BUDGET,
};

const noSleep = async () => {};

function stagesThrough(names: string[]): Stage[] {
  return names.map((name) => ({
    name: name as Stage['name'],
    maxAttempts: 1,
    run: async () => {
      if (name === 'verify') return { artifact: [{ quote: 'tests pass', kind: 'tests_pass', verdict: 'verified' }] };
      if (name === 'script') return { artifact: { scenes: [{ kind: 'title', text: 'Daily reel' }] } };
      if (name === 'ground') return { artifact: { storyboard: { scenes: [{ kind: 'title', text: 'Daily reel' }] }, dropped: [] } };
      return { artifact: {} };
    },
  }));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-reels-'));
  process.env.DAILIES_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
  delete process.env.DAILIES_OWNER_TOKEN;
});

function getDetail(id: string) {
  return getReelDetail(new Request(`http://localhost/api/reels/${id}`), { params: Promise.resolve({ id }) });
}

describe('GET /api/reels/[id]', () => {
  it('assembles the artifacts and omits media URLs for missing files', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    await runPipeline(db, id, stagesThrough(['ingest', 'edit', 'verify', 'script', 'ground']), {
      dataDir,
      sleep: noSleep,
    });

    const res = await getDetail(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { id: string };
      reel: { runId: string; status: string; approvedAt: string | null };
      storyboard: unknown;
      claims: unknown;
      timings: unknown;
      voiceMode: unknown;
      gate: unknown;
      media: { video: string | null; subtitles: string | null; poster: string | null };
    };

    expect(body.run.id).toBe(id);
    expect(body.reel).toEqual({ runId: id, status: 'draft', approvedAt: null });
    expect(body.storyboard).toEqual({ scenes: [{ kind: 'title', text: 'Daily reel' }] });
    expect(body.claims).toEqual([{ quote: 'tests pass', kind: 'tests_pass', verdict: 'verified' }]);
    expect(body.timings).toBeNull();
    expect(body.voiceMode).toBeNull();
    expect(body.gate).toBeNull();
    expect(body.media).toEqual({ video: null, subtitles: null, poster: null });

    const reelDir = join(dataDir, 'runs', id, 'reel');
    mkdirSync(reelDir, { recursive: true });
    writeFileSync(join(reelDir, 'poster.png'), Buffer.from([1, 2, 3]));

    const withPoster = await getDetail(id);
    const withPosterBody = (await withPoster.json()) as { media: { video: string | null; poster: string | null } };
    expect(withPosterBody.media.video).toBeNull();
    expect(withPosterBody.media.poster).toBe(`/media/${id}/poster.png?k=${id}`);
  });

  it('returns 404 for an unknown run and for a run that never completed ground', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    await runPipeline(db, id, stagesThrough(['ingest', 'edit', 'verify', 'script']), { dataDir, sleep: noSleep });

    expect((await getDetail(id)).status).toBe(404);
    expect((await getDetail('run_doesnotexist')).status).toBe(404);
  });
});

describe('GET /api/reels', () => {
  it('lists only approved reels, newest first', async () => {
    const db = getDb();
    const a = createRun(db, { ...runInput, repoUrl: 'https://github.com/octocat/a' });
    const b = createRun(db, { ...runInput, repoUrl: 'https://github.com/octocat/b' });
    approveReel(db, a);
    db.prepare("UPDATE reels SET approved_at = '2026-01-01T00:00:00.000Z' WHERE run_id = ?").run(a);
    approveReel(db, b);
    db.prepare("UPDATE reels SET approved_at = '2026-01-02T00:00:00.000Z' WHERE run_id = ?").run(b);

    const res = await listReels(new Request('http://localhost/api/reels'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string }[];
    expect(body.map((r) => r.runId)).toEqual([b, a]);
  });
});

describe('POST /api/reels/[id]/approve', () => {
  function approve(id: string, headers: Record<string, string> = {}) {
    return approveRoute(new Request(`http://localhost/api/reels/${id}/approve`, { method: 'POST', headers }), {
      params: Promise.resolve({ id }),
    });
  }

  it('returns 503 when DAILIES_OWNER_TOKEN is unset', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    const res = await approve(id, { 'x-owner-token': 'anything' });
    expect(res.status).toBe(503);
  });

  it('returns 401 without the correct owner token', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput);

    expect((await approve(id)).status).toBe(401);
    expect((await approve(id, { 'x-owner-token': 'wrong' })).status).toBe(401);
  });

  it('returns 409 for a run that is not needs_approval', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput); // status 'running'

    const res = await approve(id, { 'x-owner-token': 'secret-token' });
    expect(res.status).toBe(409);
  });

  it('approves a needs_approval run with the correct token', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput);
    db.prepare("UPDATE runs SET status = 'needs_approval' WHERE id = ?").run(id);

    const res = await approve(id, { 'x-owner-token': 'secret-token' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('approved');
  });
});

describe('POST /api/reels/[id]/feedback', () => {
  function sendFeedback(id: string, text: unknown, headers: Record<string, string> = {}) {
    return feedbackRoute(
      new Request(`http://localhost/api/reels/${id}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ text }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  it('rejects empty or over-long text with 400', async () => {
    const db = getDb();
    const id = createRun(db, runInput);

    expect((await sendFeedback(id, '')).status).toBe(400);
    expect((await sendFeedback(id, 'x'.repeat(1001))).status).toBe(400);
  });

  it('returns 404 for an unknown run', async () => {
    expect((await sendFeedback('run_doesnotexist', 'hello')).status).toBe(404);
  });

  it('stores feedback without an owner token and does not recut', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    await runPipeline(db, id, stagesThrough(['ingest', 'edit', 'verify']), { dataDir, sleep: noSleep });
    db.prepare("UPDATE runs SET status = 'needs_approval' WHERE id = ?").run(id);

    const res = await sendFeedback(id, 'too slow, trim it');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recut: boolean };
    expect(body.recut).toBe(false);
    expect(getRun(db, id).status).toBe('needs_approval');

    const rows = db.prepare('SELECT text FROM feedback WHERE run_id = ?').all(id) as { text: string }[];
    expect(rows).toEqual([{ text: 'too slow, trim it' }]);
  });

  it('with the owner token calls recut and the run is running again', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput);
    await runPipeline(db, id, stagesThrough(['ingest', 'edit', 'verify']), { dataDir, sleep: noSleep });
    db.prepare("UPDATE runs SET status = 'needs_approval' WHERE id = ?").run(id);

    const res = await sendFeedback(id, 'make it punchier', { 'x-owner-token': 'secret-token' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recut: boolean };
    expect(body.recut).toBe(true);
    expect(getRun(db, id).status).toBe('running');
  });

  it('a re-cut of an approved reel sets it back to draft, while the new cut renders', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput);
    await runPipeline(db, id, stagesThrough(['ingest', 'edit', 'verify']), { dataDir, sleep: noSleep });
    db.prepare("UPDATE runs SET status = 'needs_approval' WHERE id = ?").run(id);
    approveReel(db, id);
    expect(getReel(db, id)!.status).toBe('approved');

    const res = await sendFeedback(id, 'make it punchier', { 'x-owner-token': 'secret-token' });

    expect(res.status).toBe(200);
    expect((await res.json()) as { recut: boolean }).toEqual({ recut: true });
    expect(getReel(db, id)).toEqual({ runId: id, status: 'draft', approvedAt: null });
  });

  it('with the owner token does not recut a run that is still running', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput); // status 'running' by default
    // verify is done but the run itself is still 'running' -- e.g. the
    // worker is mid-flight on 'script' in another process right now.
    for (const name of ['ingest', 'edit', 'verify']) {
      db.prepare(
        "INSERT INTO stages (run_id, name, status, attempt) VALUES (?, ?, 'done', 1)",
      ).run(id, name);
    }

    const res = await sendFeedback(id, 'make it punchier', { 'x-owner-token': 'secret-token' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recut: boolean };
    expect(body.recut).toBe(false);
    expect(getRun(db, id).status).toBe('running');
  });
});
