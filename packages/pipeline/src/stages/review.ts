import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { completeJson, type ModelClient } from '@dailies/agent';
import { detectSilences } from '@dailies/voice';
import { renderStills as renderStillsReal } from '@dailies/reel';
import { Finding, type LineTiming, type RenderArtifact, type Storyboard } from '@dailies/core';
import type { Stage, StageContext, StageResult } from '../types';
import { reviewerPrompt } from '../prompts/reviewer';

const execFileAsync = promisify(execFile);
const STILL_BATCH_SIZE = 4;
const DURATION_FLOOR_SEC = 20;

// Task 8 (not merged into this worktree) owns `GroundArtifact`/`VoiceArtifact`; these mirror the
// shapes documented in the plan's Task 8 Interfaces for the two fields this stage actually reads.
interface ReviewGroundInput {
  storyboard: Storyboard;
}
interface ReviewVoiceInput {
  audioPath: string | null;
  timings: LineTiming[];
}

export function durationFinding(actualSec: number, targetSec: number): Finding | null {
  if (actualSec > targetSec * 1.25) {
    return {
      sceneId: null,
      issue: `reel runs ${actualSec.toFixed(1)}s, more than 25% over the ${targetSec}s target`,
      severity: 'high',
      fix: 'shorten narration lines or drop a scene',
    };
  }
  if (actualSec < DURATION_FLOOR_SEC) {
    return {
      sceneId: null,
      issue: `reel runs ${actualSec.toFixed(1)}s, under the ${DURATION_FLOOR_SEC}s floor`,
      severity: 'high',
      fix: 'add scenes or narration',
    };
  }
  return null;
}

async function runFfmpegStderr(args: string[]): Promise<string> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });
    return stderr;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? '';
  }
}

async function blackFindings(videoPath: string): Promise<Finding[]> {
  const stderr = await runFfmpegStderr(['-i', videoPath, '-vf', 'blackdetect=d=0.5', '-an', '-f', 'null', '-']);
  const findings: Finding[] = [];
  for (const m of stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
    const start = Number(m[1]);
    if (start > 1) {
      findings.push({
        sceneId: null,
        issue: `black frames from ${m[1]}s to ${m[2]}s (${m[3]}s)`,
        severity: 'high',
        fix: 'investigate the render for the scene at that timestamp',
      });
    }
  }
  return findings;
}

async function silenceFindings(audioPath: string | null): Promise<Finding[]> {
  if (audioPath === null) return [];
  const gaps = await detectSilences(audioPath, { minSec: 1.8 });
  return gaps.map((g) => ({
    sceneId: null,
    issue: `silent gap from ${g.start.toFixed(1)}s to ${g.end.toFixed(1)}s in the narration`,
    severity: 'low' as const,
    fix: 'tighten the pause or re-time the line',
  }));
}

function toDataUrl(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const MAX_FINDING_TEXT_LEN = 240;
const MAX_FINDINGS = 50;
const MAX_REASON_LEN = 2000;
const stripControlChars = (s: string): string => s.replace(/[\r\n\t]+/g, ' ');
const truncate = (s: string, max: number): string => {
  const flat = stripControlChars(s);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// The vision model reads the rendered stills, which ultimately carry content derived from the
// repository under review; treat its reply as untrusted. A `sceneId` it did not get handed back
// unmodified is not a real scene, and `issue`/`fix` text is capped before it can reach `reason`,
// which the runner forwards verbatim as `ctx.feedback` into the next stage's prompt.
function sanitizeVisionFinding(f: Finding, validSceneIds: Set<string>): Finding {
  return {
    sceneId: f.sceneId !== null && validSceneIds.has(f.sceneId) ? f.sceneId : null,
    issue: truncate(f.issue, MAX_FINDING_TEXT_LEN),
    severity: f.severity,
    fix: truncate(f.fix, MAX_FINDING_TEXT_LEN),
  };
}

// A bare array, not `{ findings: [...] }`: validating that shape takes a zod object schema built
// with `z.object`, and this package has no direct dependency on `zod` to build one with (only
// `@dailies/core` and `@dailies/agent` do). `Finding.array()` reuses the schema already imported
// from core instead of adding that dependency just for this one call.
async function visionFindings(client: ModelClient, stills: { sceneId: string; path: string }[], validSceneIds: Set<string>): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (let i = 0; i < stills.length; i += STILL_BATCH_SIZE) {
    const batch = stills.slice(i, i + STILL_BATCH_SIZE);
    const { system, user } = reviewerPrompt(batch.map((s) => ({ sceneId: s.sceneId, dataUrl: toDataUrl(s.path) })));
    const reply = await completeJson({ client, role: 'vision', name: 'reviewer', system, user, output: Finding.array() });
    findings.push(...reply.map((f) => sanitizeVisionFinding(f, validSceneIds)));
  }
  return findings;
}

export interface ReviewStageDeps {
  client: ModelClient;
  renderStills: typeof renderStillsReal;
}

/** Same behaviour as `reviewStage`, with `renderStills` injectable so unit tests never drive a real browser. */
export function buildReviewStage(deps: ReviewStageDeps): Stage<{ pass: boolean; findings: Finding[] }> {
  return {
    name: 'review',
    maxAttempts: 2,
    async run(ctx: StageContext): Promise<StageResult<{ pass: boolean; findings: Finding[] }>> {
      const render = ctx.read<RenderArtifact>('render');
      const ground = ctx.read<ReviewGroundInput>('ground');
      const voice = ctx.read<ReviewVoiceInput>('voice');

      const findings: Finding[] = [];
      const duration = durationFinding(render.durationSec, ground.storyboard.targetSec);
      if (duration) findings.push(duration);
      findings.push(...(await blackFindings(render.videoPath)));
      findings.push(...(await silenceFindings(voice.audioPath)));

      const stills = await deps.renderStills({
        storyboard: ground.storyboard,
        timings: voice.timings,
        outDir: join(ctx.runDir, 'review-stills'),
      });
      const validSceneIds = new Set(ground.storyboard.scenes.map((s) => s.id));
      findings.push(...(await visionFindings(deps.client, stills, validSceneIds)));

      // Gate on the full list: capping is only about bounding what gets stored and forwarded, and
      // must never let a flood of low-severity findings push a real high-severity one off the end
      // and out of the decision. Highs are kept first in the capped list for the same reason.
      const pass = !findings.some((f) => f.severity === 'high');
      const bounded = [...findings.filter((f) => f.severity === 'high'), ...findings.filter((f) => f.severity === 'low')].slice(0, MAX_FINDINGS);
      if (!pass) {
        const reason = truncate(bounded.map((f) => `${f.sceneId ?? 'reel'}: ${f.issue}`).join('; '), MAX_REASON_LEN);
        return { artifact: { pass, findings: bounded }, loopBackTo: 'script', reason };
      }
      return { artifact: { pass, findings: bounded } };
    },
  };
}

export function reviewStage(deps: { client: ModelClient }): Stage<{ pass: boolean; findings: Finding[] }> {
  return buildReviewStage({ client: deps.client, renderStills: renderStillsReal });
}
