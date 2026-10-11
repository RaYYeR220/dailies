/**
 * Seeds a data directory so every page has something real to show, without the pipeline or any key.
 *
 *   pnpm --filter @dailies/web exec tsx test/ui/seed.ts <dataDir> [--frames <dir>]
 *
 * It writes the rows and the stage artifacts the worker would have written, in the shapes the plan gives
 * them, and makes the three media files with ffmpeg: a plain dark video of the right length by default,
 * or, with --frames, a video cut from seven PNG stills (one per scene, in name order).
 * Then start the app with DAILIES_DATA_DIR pointing at the same directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_BUDGET, type Claim, type LineTiming, type Storyboard } from '@dailies/core';
import { openDb, type Database } from '@dailies/pipeline';
import { ensureWebTables } from '../../src/server/store';
import { AUDIO_OFFSET_SEC, claimCounts, sceneSpans } from '../../src/ui/reel-model';
import { claims, REPO_URL, storyboard, timings } from './fixtures';

export const SEEDED = {
  ready: 'run_a11ce0000001',
  running: 'run_b0b000000002',
  blocked: 'run_c0ffee000003',
  failed: 'run_dead00000004',
  queued: 'run_0000000a0005',
  approved: ['run_feed00000006', 'run_feed00000007', 'run_feed00000008'],
} as const;

const T0 = Date.parse('2026-10-12T06:10:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

interface StageSeed { name: string; status: 'done' | 'running' | 'failed'; start: number; end?: number; attempt?: number; error?: string }
interface RunSeed {
  id: string;
  repoUrl: string;
  status: 'running' | 'needs_approval' | 'blocked' | 'failed';
  reason: string | null;
  costUsd: number;
  loops?: number;
  createdSecAgo?: number;
  stages: StageSeed[];
  events: [sec: number, stage: string, message: string][];
}

function insertRun(db: Database, run: RunSeed): void {
  // A run that is still going is dated from now, so its clocks read like a run in progress.
  const base = run.createdSecAgo !== undefined ? Date.now() - run.createdSecAgo * 1000 : T0;
  const iso = (sec: number) => new Date(base + sec * 1000).toISOString();
  db.prepare(
    `INSERT INTO runs (id, repo_url, since, until, status, reason, cost_usd, loops, budget, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(run.id, run.repoUrl, at(-7 * 86400), at(0), run.status, run.reason, run.costUsd, run.loops ?? 0, JSON.stringify(DEFAULT_BUDGET), iso(0));
  for (const s of run.stages) {
    db.prepare('INSERT INTO stages (run_id, name, status, attempt, started_at, ended_at, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      run.id, s.name, s.status, s.attempt ?? 1, iso(s.start), s.end === undefined ? null : iso(s.end), s.error ?? null,
    );
  }
  for (const [sec, stage, message] of run.events) {
    db.prepare('INSERT INTO events (run_id, ts, stage, message) VALUES (?, ?, ?, ?)').run(run.id, iso(sec), stage, message);
  }
}

const DONE: StageSeed[] = [
  { name: 'ingest', status: 'done', start: 1, end: 8 },
  { name: 'edit', status: 'done', start: 8, end: 13 },
  { name: 'verify', status: 'done', start: 13, end: 20 },
  { name: 'script', status: 'done', start: 20, end: 28 },
  { name: 'ground', status: 'done', start: 28, end: 37 },
  { name: 'voice', status: 'done', start: 37, end: 49 },
  { name: 'render', status: 'done', start: 49, end: 93 },
  { name: 'review', status: 'done', start: 93, end: 104 },
  { name: 'gate', status: 'done', start: 104, end: 105 },
];

const EVENTS: RunSeed['events'] = [
  [7, 'ingest', '4 sessions from Entire checkpoints: 212 tool calls, 9 commits, 3 secrets redacted'],
  [13, 'edit', '5 beats in 11 editor steps'],
  [20, 'verify', '6 claims (1 dropped for a quote not in the transcript): 2 verified, 1 contradicted, 1 stale, 2 unverifiable'],
  [28, 'script', '7 scenes, 7 narration lines, 1 flag scene'],
  [31, 'ground', 'line l3 failed the entailment check: "The tests now pass reliably." Rewriting'],
  [34, 'ground', 'line l3 rewritten: "The last run shows 14 tests passing."'],
  [37, 'ground', '7 of 7 lines grounded, 0 dropped'],
  [49, 'voice', 'captions mode: no voice provider configured, timings estimated for 7 lines'],
  [93, 'render', 'reel.mp4 written, 30.5 s at 1920x1080'],
  [104, 'review', '0 high and 1 low finding: silent gap from 12.1s to 14.0s in the narration'],
  [105, 'gate', 'grounding, secrets, cost and review passed'],
];

function writeJson(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value));
}

const srtStamp = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** One cue per narration line, shifted to video time: what the renderer writes next to the video. */
function toSrt(sb: Storyboard, lineTimings: LineTiming[]): string {
  const text = new Map(sb.scenes.flatMap((s) => s.lines.map((l) => [l.id, l.text] as const)));
  return lineTimings
    .map((t, i) => `${i + 1}\n${srtStamp(t.startSec + AUDIO_OFFSET_SEC)} --> ${srtStamp(t.endSec + AUDIO_OFFSET_SEC)}\n${text.get(t.lineId) ?? ''}\n`)
    .join('\n');
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** reel.mp4 and poster.png: cut from stills when given, otherwise a plain frame held for the reel's length. */
function writeMedia(reelDir: string, sb: Storyboard, lineTimings: LineTiming[], frames: string[] | null): void {
  const spans = sceneSpans(sb, lineTimings, AUDIO_OFFSET_SEC)!;
  const total = spans.at(-1)!.endSec;
  const video = join(reelDir, 'reel.mp4');
  const poster = join(reelDir, 'poster.png');
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart'];
  const quiet = ['-hide_banner', '-loglevel', 'error', '-y'];

  if (frames && frames.length >= spans.length) {
    const list = join(reelDir, 'frames.txt');
    // The concat demuxer needs the last file named twice for its duration to count.
    const entries = spans.map((s, i) => `file '${frames[i]}'\nduration ${(s.endSec - s.startSec).toFixed(3)}`);
    writeFileSync(list, `${entries.join('\n')}\nfile '${frames[spans.length - 1]}'\n`);
    execFileSync('ffmpeg', [...quiet, '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'scale=1280:720', '-t', total.toFixed(2), ...encode, video]);
    execFileSync('ffmpeg', [...quiet, '-i', frames[0]!, '-vf', 'scale=1280:720', '-frames:v', '1', '-update', '1', poster]);
    return;
  }
  const plain = `color=c=0x16221e:s=1280x720:d=${total.toFixed(2)}`;
  execFileSync('ffmpeg', [...quiet, '-f', 'lavfi', '-i', plain, ...encode, video]);
  execFileSync('ffmpeg', [...quiet, '-f', 'lavfi', '-i', 'color=c=0x16221e:s=1280x720:d=1', '-frames:v', '1', '-update', '1', poster]);
}

function writeFinishedArtifacts(dataDir: string, id: string, sb: Storyboard, o: { frames: string[] | null; media: boolean; gate: unknown }): void {
  const dir = join(dataDir, 'runs', id);
  const claimList: Claim[] = claims();
  const lineTimings = timings();
  const { total: _total, ...counts } = claimCounts(claimList);
  writeJson(dir, 'verify.json', { claims: claimList, counts });
  writeJson(dir, 'script.json', sb);
  writeJson(dir, 'ground.json', { storyboard: sb, dropped: [], kept: 7 });
  writeJson(dir, 'voice.json', { mode: 'captions', audioPath: null, timings: lineTimings, calls: 0 });
  writeJson(dir, 'review.json', { pass: true, findings: [] });
  writeJson(dir, 'gate.json', o.gate);
  if (!o.media) return;
  const reelDir = join(dir, 'reel');
  mkdirSync(reelDir, { recursive: true });
  writeFileSync(join(reelDir, 'reel.srt'), toSrt(sb, lineTimings));
  writeMedia(reelDir, sb, lineTimings, o.frames);
}

const check = (name: string, pass = true, reasons: string[] = []) => ({ name, pass, reasons });
const GATE_PASS = { checks: [check('grounding'), check('secrets'), check('cost'), check('review')] };

export function seed(dataDir: string, o: { frames?: string | null; media?: boolean } = {}): typeof SEEDED {
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'dailies.db'));
  ensureWebTables(db);
  for (const table of ['runs', 'stages', 'events', 'reels', 'feedback', 'run_requests']) db.exec(`DELETE FROM ${table}`);

  const ffmpeg = o.media !== false && hasFfmpeg();
  if (o.media !== false && !ffmpeg) console.warn('ffmpeg not found: seeding without video, subtitles or posters');
  const frames = o.frames
    ? readdirSync(o.frames).filter((f) => /^frame-\d+\.png$/.test(f)).sort().map((f) => resolve(o.frames!, f))
    : null;

  // 1. A finished run, waiting for a person.
  insertRun(db, { id: SEEDED.ready, repoUrl: REPO_URL, status: 'needs_approval', reason: 'awaiting human approval', costUsd: 0.31, loops: 1, stages: DONE, events: EVENTS });
  writeFinishedArtifacts(dataDir, SEEDED.ready, storyboard(SEEDED.ready), { frames, media: ffmpeg, gate: GATE_PASS });

  // 2. A run in progress, four stages in and grounding the script.
  insertRun(db, {
    id: SEEDED.running, repoUrl: REPO_URL, status: 'running', reason: null, costUsd: 0.14, createdSecAgo: 35,
    stages: [...DONE.slice(0, 4), { name: 'ground', status: 'running', start: 28 }],
    events: [...EVENTS.slice(0, 6), [35, 'ground', 'checking line l5 against entries s3:204 and s3:212']],
  });

  // 3. A run the gate stopped: over budget, and a secret-shaped string on screen.
  insertRun(db, {
    id: SEEDED.blocked, repoUrl: 'https://github.com/acme/billing', status: 'blocked', reason: 'secrets, cost', costUsd: 0.71, stages: DONE,
    events: [...EVENTS.slice(0, 10), [105, 'gate', 'blocked: secrets, cost']],
  });
  writeFinishedArtifacts(dataDir, SEEDED.blocked, { ...storyboard(SEEDED.blocked), repo: 'acme/billing' }, {
    frames: null, media: false,
    gate: { checks: [check('grounding'), check('secrets', false, ['a key-shaped string in the terminal scene, step 2']), check('cost', false, ['spent $0.71 of a $0.60 budget']), check('review', true, ['review skipped'])] },
  });

  // 4. A run that failed in verify after two attempts.
  insertRun(db, {
    id: SEEDED.failed, repoUrl: 'https://github.com/acme/search', status: 'failed', reason: 'model reply was not valid JSON for the schema after one repair turn', costUsd: 0.06,
    stages: [...DONE.slice(0, 2), { name: 'verify', status: 'failed', start: 13, end: 31, attempt: 2, error: 'model reply was not valid JSON for the schema after one repair turn' }],
    events: EVENTS.slice(0, 2),
  });

  // 5. A run nobody has picked up yet.
  insertRun(db, { id: SEEDED.queued, repoUrl: 'https://github.com/acme/docs', status: 'running', reason: null, costUsd: 0, createdSecAgo: 4, stages: [], events: [] });

  // 6. Approved reels, for the gallery.
  const repos = ['acme/retry-queue', 'acme/api', 'entireio/cli'];
  SEEDED.approved.forEach((id, i) => {
    insertRun(db, { id, repoUrl: `https://github.com/${repos[i]}`, status: 'needs_approval', reason: 'awaiting human approval', costUsd: 0.22 + i * 0.07, stages: DONE, events: EVENTS });
    writeFinishedArtifacts(dataDir, id, { ...storyboard(id), repo: repos[i]! }, { frames, media: ffmpeg, gate: GATE_PASS });
    db.prepare(`INSERT INTO reels (run_id, status, approved_at) VALUES (?, 'approved', ?)`).run(id, at(-i * 86400 - 3600));
  });

  db.close();
  return SEEDED;
}

// `tsx test/ui/seed.ts <dataDir> [--frames <dir>]`
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [dataDir, ...rest] = process.argv.slice(2);
  if (!dataDir) {
    console.error('usage: tsx test/ui/seed.ts <dataDir> [--frames <dir with frame-1.png … frame-7.png>]');
    process.exit(2);
  }
  const framesAt = rest.indexOf('--frames');
  const frames = framesAt === -1 ? null : rest[framesAt + 1] ?? null;
  if (frames && !existsSync(frames)) {
    console.error(`no such directory: ${frames}`);
    process.exit(2);
  }
  console.log(JSON.stringify(seed(resolve(dataDir), { frames }), null, 2));
  console.log(`\nstart the app with DAILIES_DATA_DIR=${resolve(dataDir)} NEXT_PUBLIC_FEATURED_RUN=${SEEDED.approved[0]}`);
}
