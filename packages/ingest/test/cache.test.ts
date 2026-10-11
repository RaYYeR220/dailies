import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { CACHE_FORMAT_VERSION, readSessionCache, sessionCachePath, writeSessionCache } from '../src/cache';

describe('session cache', () => {
  it('round-trips a write then read when the transcript oid matches', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dailies-cache-'));
    const path = sessionCachePath(dataDir, '/repo/a', 'cp1', 0);
    const data = { transcriptOid: 'a'.repeat(40), entries: [], redactions: 0 };

    await writeSessionCache(path, data);
    const hit = await readSessionCache(path, data.transcriptOid);

    expect(hit).toEqual(data);
  });

  it('misses when the transcript oid differs', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dailies-cache-'));
    const path = sessionCachePath(dataDir, '/repo/a', 'cp1', 0);
    await writeSessionCache(path, { transcriptOid: 'a'.repeat(40), entries: [], redactions: 0 });

    const miss = await readSessionCache(path, 'b'.repeat(40));

    expect(miss).toBeNull();
  });

  it('misses a cache file written under an older format version', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'dailies-cache-'));
    const path = sessionCachePath(dataDir, '/repo/a', 'cp1', 0);
    await mkdir(dirname(path), { recursive: true });
    const stale = { transcriptOid: 'a'.repeat(40), entries: [], redactions: 0, version: CACHE_FORMAT_VERSION - 1 };
    await writeFile(path, JSON.stringify(stale));

    const miss = await readSessionCache(path, stale.transcriptOid);

    expect(miss).toBeNull();
  });

  it('namespaces the cache path by repository, so two repos never collide on the same checkpoint id', () => {
    const dataDir = '/tmp/shared-datadir';
    const pathForRepoA = sessionCachePath(dataDir, '/repos/a', 'cp1', 0);
    const pathForRepoB = sessionCachePath(dataDir, '/repos/b', 'cp1', 0);

    expect(pathForRepoA).not.toBe(pathForRepoB);
  });
});
