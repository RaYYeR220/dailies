import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readStageArtifact<T>(dataDir: string, runId: string, stage: string): T | null {
  const path = join(dataDir, 'runs', runId, `${stage}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function mediaFilePath(dataDir: string, runId: string, file: string): string {
  return join(dataDir, 'runs', runId, 'reel', file);
}
