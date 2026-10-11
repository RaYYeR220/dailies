import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '@dailies/core';
import { openDb } from '@dailies/pipeline';
import type { Database } from '@dailies/pipeline';
import { ensureWebTables } from './store';

let cached: { path: string; db: Database } | null = null;

export function getDataDir(): string {
  return loadEnv().dataDir;
}

export function getDb(): Database {
  const dataDir = getDataDir();
  const path = join(dataDir, 'dailies.db');
  if (cached?.path !== path) {
    mkdirSync(dataDir, { recursive: true });
    const db = openDb(path);
    ensureWebTables(db);
    cached = { path, db };
  }
  return cached.db;
}
