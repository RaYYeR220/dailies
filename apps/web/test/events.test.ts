import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun } from '@dailies/pipeline';
import { DEFAULT_BUDGET } from '@dailies/core';
import { getDb } from '../src/server/db';
import { GET } from '../src/app/api/runs/[id]/events/route';

let dataDir: string;

const runInput = {
  repoUrl: 'https://github.com/octocat/hello-world',
  since: '2026-01-01T00:00:00Z',
  until: '2026-01-02T00:00:00Z',
  budget: DEFAULT_BUDGET,
};

function insertEvent(runId: string, message: string) {
  getDb()
    .prepare('INSERT INTO events (run_id, ts, stage, message) VALUES (?, ?, ?, ?)')
    .run(runId, new Date().toISOString(), null, message);
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-events-'));
  process.env.DAILIES_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
  vi.useRealTimers();
});

describe('GET /api/runs/[id]/events', () => {
  it('replays events after Last-Event-ID and ends with event: done', async () => {
    const db = getDb();
    const id = createRun(db, runInput);
    insertEvent(id, 'first'); // id 1
    insertEvent(id, 'second'); // id 2
    insertEvent(id, 'third'); // id 3
    db.prepare("UPDATE runs SET status = 'blocked' WHERE id = ?").run(id);

    const request = new Request(`http://localhost/api/runs/${id}/events`, {
      headers: { 'Last-Event-ID': '1' },
    });
    const res = await GET(request, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);

    const text = await readAll(res.body!);
    expect(text).not.toContain('"message":"first"');
    expect(text).toContain('id: 2');
    expect(text).toContain('"message":"second"');
    expect(text).toContain('id: 3');
    expect(text).toContain('"message":"third"');
    expect(text.trim().endsWith('event: done\ndata: {}')).toBe(true);
  });

  it('stops polling when the request is aborted', async () => {
    vi.useFakeTimers();
    const db = getDb();
    const id = createRun(db, runInput);
    insertEvent(id, 'before-abort'); // id 1, delivered on the first synchronous tick

    const controller = new AbortController();
    const request = new Request(`http://localhost/api/runs/${id}/events`, { signal: controller.signal });
    const res = await GET(request, { params: Promise.resolve({ id }) });
    const reader = res.body!.getReader();

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain('before-abort');

    controller.abort();
    insertEvent(id, 'after-abort'); // id 2, inserted after the client is gone
    await vi.advanceTimersByTimeAsync(5000); // long enough for several 1s polls, had they survived

    const second = await reader.read();
    expect(second.done).toBe(true);
    expect(second.value).toBeUndefined();
  });
});
