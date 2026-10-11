import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '@dailies/pipeline';
import { DEFAULT_BUDGET } from '@dailies/core';
import { getDb } from '../src/server/db';
import { approveReel } from '../src/server/store';
import { GET } from '../src/app/media/[id]/[file]/route';

let dataDir: string;

const runInput = {
  repoUrl: 'https://github.com/octocat/hello-world',
  since: '2026-01-01T00:00:00Z',
  until: '2026-01-02T00:00:00Z',
  budget: DEFAULT_BUDGET,
};

function request(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, { headers });
}

function media(id: string, file: string, opts: { headers?: Record<string, string>; search?: string } = {}) {
  return GET(request(`/media/${id}/${file}${opts.search ?? ''}`, opts.headers), {
    params: Promise.resolve({ id, file }),
  });
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-media-'));
  process.env.DAILIES_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
  delete process.env.DAILIES_OWNER_TOKEN;
});

describe('GET /media/[id]/[file]', () => {
  it('rejects path traversal and unknown file names with 400, before touching the filesystem', async () => {
    // dataDir is never created on disk; a 400 here proves validation ran first.
    rmSync(dataDir, { recursive: true, force: true });

    expect((await media('../../etc', 'reel.mp4')).status).toBe(400);
    expect((await media('run_abc123', '../../.env')).status).toBe(400);
    expect((await media('run_abc123', 'secret.txt')).status).toBe(400);
    expect((await media('not-a-run-id', 'reel.mp4')).status).toBe(400);
  });

  it('honours a Range header with 206 and Content-Range', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    approveReel(db, id);
    const reelDir = join(dataDir, 'runs', id, 'reel');
    mkdirSync(reelDir, { recursive: true });
    writeFileSync(join(reelDir, 'reel.mp4'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

    const full = await media(id, 'reel.mp4');
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('10');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

    const ranged = await media(id, 'reel.mp4', { headers: { Range: 'bytes=2-5' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(ranged.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(Uint8Array.from([2, 3, 4, 5]));

    // A suffix range ("bytes=-N") means the last N bytes, per RFC 7233.
    const suffix = await media(id, 'reel.mp4', { headers: { Range: 'bytes=-3' } });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(Uint8Array.from([7, 8, 9]));
  });

  it('serves an approved reel to anyone, and a draft reel only with the owner token or ?k=', async () => {
    process.env.DAILIES_OWNER_TOKEN = 'secret-token';
    const db = getDb();
    const id = createRun(db, runInput); // reel stays draft (never approved)
    const reelDir = join(dataDir, 'runs', id, 'reel');
    mkdirSync(reelDir, { recursive: true });
    writeFileSync(join(reelDir, 'poster.png'), Buffer.from([9, 9]));

    expect((await media(id, 'poster.png')).status).toBe(403);
    expect((await media(id, 'poster.png', { search: `?k=${id}` })).status).toBe(200);
    expect((await media(id, 'poster.png', { headers: { 'x-owner-token': 'secret-token' } })).status).toBe(200);
    expect((await media(id, 'poster.png', { headers: { 'x-owner-token': 'wrong' } })).status).toBe(403);

    approveReel(db, id);
    expect((await media(id, 'poster.png')).status).toBe(200);
  });

  it('returns 404 when the file does not exist on disk', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    approveReel(db, id);

    expect((await media(id, 'reel.srt')).status).toBe(404);
  });
});
