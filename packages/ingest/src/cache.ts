import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Entry } from '@dailies/core';

export interface CachedSession {
  transcriptOid: string;
  entries: Entry[];
  redactions: number;
}

export function sessionCachePath(dataDir: string, checkpointId: string, sessionIndex: number): string {
  return resolve(dataDir, 'cache', 'sessions', `${checkpointId}-${sessionIndex}.json`);
}

/** Returns the cached parse of a session when its transcript blob id still matches, else `null`. */
export async function readSessionCache(path: string, transcriptOid: string | null): Promise<CachedSession | null> {
  if (!transcriptOid) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as CachedSession;
    if (data.transcriptOid !== transcriptOid) return null;
    return data;
  } catch {
    return null;
  }
}

/** Caching is an optimization, not a correctness requirement, so a write failure here must not fail the ingest. */
export async function writeSessionCache(path: string, data: CachedSession): Promise<void> {
  if (!data.transcriptOid) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(data));
  } catch {
    /* best-effort cache */
  }
}
