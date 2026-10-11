import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beat, heartbeatAgeSec } from '../src/server/heartbeat';
import { GET } from '../src/app/api/health/route';

let dataDir: string;

function getHealth() {
  return GET(new Request('http://localhost/api/health'));
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-health-'));
  process.env.DAILIES_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
});

describe('beat / heartbeatAgeSec', () => {
  it('heartbeatAgeSec returns null when the heartbeat file is absent', () => {
    expect(heartbeatAgeSec(dataDir)).toBeNull();
  });

  it('beat writes an ISO timestamp that heartbeatAgeSec reads back as a zero age', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    beat(dataDir, now);

    const written = readFileSync(join(dataDir, 'worker.heartbeat'), 'utf8').trim();
    expect(written).toBe('2026-01-01T00:00:00.000Z');
    expect(heartbeatAgeSec(dataDir, now)).toBe(0);
  });

  it('heartbeatAgeSec reports the elapsed seconds once the heartbeat goes stale', () => {
    const written = new Date('2026-01-01T00:00:00.000Z');
    beat(dataDir, written);

    const later = new Date('2026-01-01T00:02:00.000Z');
    expect(heartbeatAgeSec(dataDir, later)).toBe(120);
  });
});

describe('GET /api/health', () => {
  it('returns 200 and ok:true when the heartbeat is fresh', async () => {
    beat(dataDir);

    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: boolean; workerAgeSec: number | null };
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(body.workerAgeSec).not.toBeNull();
    expect(body.workerAgeSec!).toBeLessThan(60);
  });

  it('returns 503 and ok:false when the heartbeat is stale', async () => {
    beat(dataDir, new Date(Date.now() - 120_000));

    const res = await getHealth();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: boolean; workerAgeSec: number | null };
    expect(body.ok).toBe(false);
    expect(body.db).toBe(true);
    expect(body.workerAgeSec!).toBeGreaterThanOrEqual(60);
  });

  it('returns 503 and ok:false when the heartbeat file is absent', async () => {
    const res = await getHealth();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: boolean; workerAgeSec: number | null };
    expect(body.ok).toBe(false);
    expect(body.db).toBe(true);
    expect(body.workerAgeSec).toBeNull();
  });
});
