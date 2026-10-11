import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDiff, ingest } from '../src/index';
import { getDiffsBatched, ObjectBatchReader } from '../src/git';
import { selectCandidateSessionIds } from '../src/window';
import { makeRepo } from './fixture';

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout.toString().trim());
    });
  });
}

const okLine = (text: string, ts: string) => ({
  type: 'user' as const,
  ts,
  content: [{ id: 'u1', text }],
});

describe('selectCandidateSessionIds', () => {
  it('keeps a session whose createdAt falls in the window and drops one outside it', () => {
    const survivors = selectCandidateSessionIds(
      [
        { sessionId: 'old', createdAt: '2020-01-01T00:00:00Z' },
        { sessionId: 'new', createdAt: '2026-10-10T00:00:00Z' },
      ],
      '2026-10-01T00:00:00Z',
      '2026-10-20T00:00:00Z',
      12,
    );
    expect(survivors).toEqual(new Set(['new']));
  });

  it('caps survivors to maxSessions, keeping the most recent', () => {
    const hints = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      createdAt: new Date(2026, 9, 10 + i).toISOString(),
    }));
    const survivors = selectCandidateSessionIds(hints, '2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z', 2);
    expect(survivors).toEqual(new Set(['s3', 's4']));
  });

  it('treats several copies of the same session id as one candidate', () => {
    const survivors = selectCandidateSessionIds(
      [
        { sessionId: 'shared', createdAt: '2026-10-10T00:00:00Z' },
        { sessionId: 'shared', createdAt: '2026-10-11T00:00:00Z' },
      ],
      '2026-10-01T00:00:00Z',
      '2026-10-20T00:00:00Z',
      12,
    );
    expect(survivors).toEqual(new Set(['shared']));
  });
});

describe('getDiffsBatched', () => {
  it('produces the same patches as per-commit getDiff for a three-commit fixture', async () => {
    const repoDir = await makeRepo({ layout: 'refs', checkpoints: [] });
    const shas: string[] = [];
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      await writeFile(join(repoDir, name), `${name} line one\n`);
      await run(repoDir, ['add', name]);
      await run(repoDir, ['commit', '-q', '-m', `add ${name}`]);
      shas.push(await run(repoDir, ['rev-parse', 'HEAD']));
    }

    const individually: Record<string, string> = {};
    for (const sha of shas) {
      const fileDiffs = await getDiff(repoDir, sha);
      for (const [path, patch] of Object.entries(fileDiffs)) individually[`${sha}:${path}`] = patch;
    }

    const batched = await getDiffsBatched(repoDir, shas);
    expect(batched.diffs).toEqual(individually);
    expect(batched.droppedCount).toBe(0);
  });

  it('caps at the most recent 60 commits and reports the dropped count', async () => {
    const repoDir = await makeRepo({ layout: 'refs', checkpoints: [] });
    const shas: string[] = [];
    for (let i = 0; i < 62; i += 1) {
      await writeFile(join(repoDir, 'f.txt'), `v${i}\n`);
      await run(repoDir, ['add', 'f.txt']);
      await run(repoDir, ['commit', '-q', '-m', `rev ${i}`]);
      shas.push(await run(repoDir, ['rev-parse', 'HEAD']));
    }

    const batched = await getDiffsBatched(repoDir, shas);
    expect(batched.droppedCount).toBe(2);
    expect(Object.keys(batched.diffs).filter((k) => k.endsWith(':f.txt')).length).toBe(60);
  });
});

describe('ingest performance behaviour', () => {
  it('does not read the transcript of a session outside the window', async () => {
    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'aaaa1111',
          sessions: [{ sessionId: 'old', createdAt: '2020-01-01T00:00:00Z', lines: [okLine('old session', '2020-01-01T00:00:00Z')] }],
        },
        {
          id: 'bbbb2222',
          sessions: [{ sessionId: 'new', createdAt: '2026-10-10T00:00:00Z', lines: [okLine('new session', '2026-10-10T00:00:00Z')] }],
        },
      ],
    });

    const readSpy = vi.spyOn(ObjectBatchReader.prototype, 'read');
    try {
      const artifact = await ingest({
        repoUrl: repoDir,
        dataDir: repoDir,
        since: '2026-10-01T00:00:00Z',
        until: '2026-10-20T00:00:00Z',
      });
      expect(artifact.sessions.map((s) => s.id)).toEqual(['new']);
      // 2 metadata.json reads (one per checkpoint) + 1 transcript.jsonl read (only the in-window session).
      expect(readSpy).toHaveBeenCalledTimes(3);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('reuses the parsed-session cache on a second ingest and parses zero transcripts', async () => {
    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'cccc3333',
          sessions: [{ sessionId: 's1', createdAt: '2026-10-10T07:00:00Z', lines: [okLine('cached session', '2026-10-10T07:00:00Z')] }],
        },
      ],
    });
    const opts = { repoUrl: repoDir, dataDir: repoDir, since: '2026-10-01T00:00:00Z', until: '2026-10-20T00:00:00Z' };

    const first = await ingest(opts);
    expect(first.sessions[0]!.entries).toHaveLength(1);

    const readSpy = vi.spyOn(ObjectBatchReader.prototype, 'read');
    try {
      const second = await ingest(opts);
      expect(second.sessions[0]!.entries).toEqual(first.sessions[0]!.entries);
      // Only the metadata.json read; the transcript is served from cache.
      expect(readSpy).toHaveBeenCalledTimes(1);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('invalidates the cache when the transcript object id changes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dailies-cache-'));
    const repoDir1 = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'dddd4444',
          sessions: [{ sessionId: 's1', createdAt: '2026-10-10T07:00:00Z', lines: [okLine('version one', '2026-10-10T07:00:00Z')] }],
        },
      ],
    });
    const first = await ingest({ repoUrl: repoDir1, dataDir, since: '2026-10-01T00:00:00Z', until: '2026-10-20T00:00:00Z' });
    expect(first.sessions[0]!.entries[0]!.text).toBe('version one');

    const repoDir2 = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'dddd4444',
          sessions: [{ sessionId: 's1', createdAt: '2026-10-10T07:00:00Z', lines: [okLine('version two', '2026-10-10T07:00:00Z')] }],
        },
      ],
    });
    const second = await ingest({ repoUrl: repoDir2, dataDir, since: '2026-10-01T00:00:00Z', until: '2026-10-20T00:00:00Z' });
    expect(second.sessions[0]!.entries[0]!.text).toBe('version two');
  });

  it('reports progress phases in order', async () => {
    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'eeee5555',
          sessions: [{ sessionId: 's1', createdAt: '2026-10-10T07:00:00Z', lines: [okLine('progress session', '2026-10-10T07:00:00Z')] }],
        },
      ],
    });

    const messages: string[] = [];
    await ingest({
      repoUrl: repoDir,
      dataDir: repoDir,
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-20T00:00:00Z',
      onProgress: (m) => messages.push(m),
    });

    expect(messages).toEqual(['cloning', 'read 1 checkpoints', '1 sessions in window', 'parsing 1/1', 'diffs for 1 commits']);
  });
});
