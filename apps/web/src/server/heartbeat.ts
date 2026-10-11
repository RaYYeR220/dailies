import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function heartbeatPath(dataDir: string): string {
  return join(dataDir, 'worker.heartbeat');
}

export function beat(dataDir: string, now: Date = new Date()): void {
  const path = heartbeatPath(dataDir);
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, now.toISOString());
  renameSync(tmp, path);
}

export function heartbeatAgeSec(dataDir: string, now: Date = new Date()): number | null {
  const path = heartbeatPath(dataDir);
  if (!existsSync(path)) return null;
  const written = new Date(readFileSync(path, 'utf8').trim());
  return (now.getTime() - written.getTime()) / 1000;
}
