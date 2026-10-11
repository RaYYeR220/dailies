import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Entry } from '@dailies/core';

// Bump this when parseTranscript's output shape or the redaction rules it relies on change, so a
// stale cache entry parsed under old behaviour is never served as if it reflected the current one.
export const CACHE_FORMAT_VERSION = 1;

export interface CachedSession {
  transcriptOid: string;
  entries: Entry[];
  redactions: number;
}

interface CacheFile extends CachedSession {
  version: number;
}

/** Keys the cache by a hash of the repo's resolved directory, so two repositories can never read or write each other's cache entries even if a checkpoint id happens to collide. */
export function sessionCachePath(dataDir: string, repoDir: string, checkpointId: string, sessionIndex: number): string {
  const repoKey = createHash('sha256').update(resolve(repoDir)).digest('hex').slice(0, 16);
  return resolve(dataDir, 'cache', 'sessions', repoKey, `${checkpointId}-${sessionIndex}.json`);
}

/** Returns the cached parse of a session when its format version and transcript blob id still match, else `null`. */
export async function readSessionCache(path: string, transcriptOid: string | null): Promise<CachedSession | null> {
  if (!transcriptOid) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as CacheFile;
    if (data.version !== CACHE_FORMAT_VERSION || data.transcriptOid !== transcriptOid) return null;
    return { transcriptOid: data.transcriptOid, entries: data.entries, redactions: data.redactions };
  } catch {
    return null;
  }
}

/** Caching is an optimization, not a correctness requirement, so a write failure here must not fail the ingest. */
export async function writeSessionCache(path: string, data: CachedSession): Promise<void> {
  if (!data.transcriptOid) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    const file: CacheFile = { ...data, version: CACHE_FORMAT_VERSION };
    await writeFile(path, JSON.stringify(file));
  } catch {
    /* best-effort cache */
  }
}
