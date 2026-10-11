import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getRun } from '../../src/app/api/runs/[id]/route';
import { GET as getReel } from '../../src/app/api/reels/[id]/route';
import { GET as listReels } from '../../src/app/api/reels/route';
import { stageStates } from '../../src/ui/model';
import { parseRun, parseStages } from '../../src/ui/parse';
import { parseReel } from '../../src/ui/parse-reel';
import { AUDIO_OFFSET_SEC, flagRows, narrationLines, resolveSource } from '../../src/ui/reel-model';
import { focusStage, gateFrames } from '../../src/ui/run-model';
import { seed, SEEDED } from './seed';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dailies-web-seed-'));
  process.env.DAILIES_DATA_DIR = dataDir;
  seed(dataDir, { media: false });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.DAILIES_DATA_DIR;
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const reelOf = async (id: string) => parseReel(await (await getReel(new Request(`http://localhost/api/reels/${id}`), params(id))).json());
const runOf = async (id: string) => {
  const body = (await (await getRun(new Request(`http://localhost/api/runs/${id}`), params(id))).json()) as { run: unknown; stages: unknown };
  return { run: parseRun(body.run)!, states: stageStates(parseStages(body.stages)) };
};

describe('the seeded data, read through the API the way the pages read it', () => {
  it('gives the reel page a finished run: every line timed, every source resolved, the flags listed', async () => {
    const reel = (await reelOf(SEEDED.ready))!;
    expect(reel.run.status).toBe('needs_approval');
    expect(reel.reel.status).toBe('draft');

    const lines = narrationLines(reel.storyboard!, reel.timings, AUDIO_OFFSET_SEC);
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.startSec !== null)).toBe(true);

    const ctx = { storyboard: reel.storyboard!, claims: reel.claims };
    const sources = lines.flatMap((l) => l.evidence.map((ref) => resolveSource(ref, ctx)));
    expect(sources.filter((s) => s.kind === 'entry' && s.body === null)).toEqual([]);
    expect(sources.some((s) => s.kind === 'diff' && s.hunk !== null)).toBe(true);

    expect(flagRows(reel.claims, reel.storyboard).map((f) => f.verdict)).toEqual(['contradicted', 'stale', 'unverifiable', 'unverifiable']);
    expect(gateFrames(reel.gate, reel.run.budgetUsd).every((f) => f.state === 'pass')).toBe(true);
  });

  it('gives the run page a run in each state', async () => {
    const running = await runOf(SEEDED.running);
    expect(running.run.status).toBe('running');
    expect(running.states.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'running', 'waiting', 'waiting', 'waiting', 'waiting']);

    const failed = await runOf(SEEDED.failed);
    expect(failed.states[focusStage('failed', failed.states)]).toEqual({ name: 'verify', state: 'failed' });

    const queued = await runOf(SEEDED.queued);
    expect(queued.states.every((s) => s.state === 'waiting')).toBe(true);

    const blocked = (await reelOf(SEEDED.blocked))!;
    expect(gateFrames(blocked.gate, blocked.run.budgetUsd).map((f) => f.state)).toEqual(['pass', 'fail', 'fail', 'pass']);
  });

  it('gives the gallery its approved reels, newest first', async () => {
    const reels = (await (await listReels(new Request('http://localhost/api/reels'))).json()) as { runId: string }[];
    expect(reels.map((r) => r.runId)).toEqual([...SEEDED.approved]);
  });

  it('has no reel page for a run that never grounded its script', async () => {
    expect(await reelOf(SEEDED.failed)).toBeNull();
  });
});
