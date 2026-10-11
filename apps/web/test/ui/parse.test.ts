import { describe, it, expect } from 'vitest';
import { parseGate, parseRun, parseStages } from '../../src/ui/parse';
import { parseReel } from '../../src/ui/parse-reel';
import { claims, REPO_URL, storyboard, timings } from './fixtures';

const run = {
  id: 'run_a11ce0000001', repoUrl: REPO_URL, since: '2026-10-05T06:10:00.000Z', until: '2026-10-12T06:10:00.000Z',
  status: 'needs_approval', reason: 'awaiting human approval', costUsd: 0.31, loops: 1,
  budget: { maxCostPerReelUsd: 0.6, maxTtsCalls: 3, maxRenderSec: 300 }, createdAt: '2026-10-12T06:10:00.000Z',
};

const payload = () => ({
  run,
  reel: { runId: run.id, status: 'draft', approvedAt: null },
  storyboard: storyboard(run.id),
  claims: claims(),
  timings: timings(),
  voiceMode: 'captions',
  gate: { checks: [{ name: 'grounding', pass: true, reasons: [] }] },
  media: { video: `/media/${run.id}/reel.mp4?k=${run.id}`, subtitles: null, poster: `/media/${run.id}/poster.png?k=${run.id}` },
});

describe('parseRun', () => {
  it('reads a run record', () => {
    expect(parseRun(run)).toEqual({ ...run, budgetUsd: 0.6, budget: undefined });
  });

  it('is null for a status it does not know or a record with a field missing', () => {
    expect(parseRun({ ...run, status: 'exploded' })).toBeNull();
    expect(parseRun({ ...run, repoUrl: undefined })).toBeNull();
    expect(parseRun({ ...run, budget: {} })).toBeNull();
    expect(parseRun(null)).toBeNull();
    expect(parseRun('run')).toBeNull();
  });
});

describe('parseStages', () => {
  it('keeps the rows that look like stages', () => {
    const rows = [
      { name: 'ingest', status: 'done', attempt: 1, startedAt: '2026-10-12T06:10:00.000Z', endedAt: '2026-10-12T06:10:07.000Z', error: null },
      { name: 'edit', status: 'failed', attempt: 2, startedAt: null, endedAt: null, error: 'boom' },
      { nope: true },
    ];
    expect(parseStages(rows)).toEqual(rows.slice(0, 2));
    expect(parseStages(undefined)).toEqual([]);
  });
});

describe('parseGate', () => {
  it('reads the checks and drops what is not a check', () => {
    expect(parseGate({ checks: [{ name: 'cost', pass: false, reasons: ['over', 7] }, { name: 3 }] })).toEqual({
      checks: [{ name: 'cost', pass: false, reasons: ['over'] }],
    });
  });

  it('is null until the gate has written something', () => {
    expect(parseGate(null)).toBeNull();
    expect(parseGate({})).toBeNull();
  });
});

describe('parseReel', () => {
  it('reads what GET /api/reels/[id] returns', () => {
    const reel = parseReel(payload())!;
    expect(reel.run.id).toBe(run.id);
    expect(reel.reel).toEqual({ runId: run.id, status: 'draft', approvedAt: null });
    expect(reel.storyboard!.scenes).toHaveLength(7);
    expect(reel.claims).toHaveLength(6);
    expect(reel.timings).toHaveLength(7);
    expect(reel.voiceMode).toBe('captions');
    expect(reel.gate).toEqual({ checks: [{ name: 'grounding', pass: true, reasons: [] }] });
    expect(reel.media).toEqual({ video: `/media/${run.id}/reel.mp4?k=${run.id}`, subtitles: null, poster: `/media/${run.id}/poster.png?k=${run.id}` });
  });

  it('reads the script artifact in the shape the pipeline writes it, the storyboard with what was discarded', () => {
    const reel = parseReel({ ...payload(), storyboard: { storyboard: storyboard(run.id), discarded: ['a flag scene from the writer'] } })!;
    expect(reel.storyboard!.scenes).toHaveLength(7);
    expect(reel.storyboard!.repo).toBe('acme/api');
  });

  it('reads the verify artifact in the shape the pipeline writes it, claims with their counts', () => {
    const reel = parseReel({ ...payload(), claims: { claims: claims(), counts: { verified: 2 } } })!;
    expect(reel.claims).toHaveLength(6);
  });

  it('keeps the claims that parse and drops the ones that do not', () => {
    const reel = parseReel({ ...payload(), claims: [...claims(), { quote: 'no id' }] })!;
    expect(reel.claims).toHaveLength(6);
  });

  it('has no storyboard, rather than a guess, when the artifact is not one', () => {
    const reel = parseReel({ ...payload(), storyboard: { scenes: [{ kind: 'title' }] }, timings: null, voiceMode: null, gate: null })!;
    expect(reel.storyboard).toBeNull();
    expect(reel.timings).toBeNull();
    expect(reel.voiceMode).toBeNull();
    expect(reel.gate).toBeNull();
  });

  it('only accepts media addresses on this site', () => {
    const reel = parseReel({ ...payload(), media: { video: 'https://evil.example/x.mp4', subtitles: 'javascript:alert(1)', poster: '//evil.example/p.png' } })!;
    expect(reel.media).toEqual({ video: null, subtitles: null, poster: null });
  });

  it('is null when the run itself cannot be read', () => {
    expect(parseReel({ ...payload(), run: {} })).toBeNull();
    expect(parseReel(null)).toBeNull();
  });
});
