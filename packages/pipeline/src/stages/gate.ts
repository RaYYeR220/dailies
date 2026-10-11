import { z } from 'zod';
import { guard } from '@dailies/agent';
import { computeFacts, Finding, redact, Storyboard, type IngestArtifact } from '@dailies/core';
import type { Stage, StageContext } from '../types';
import { oneLine } from './edit';
import { checked, evidenceResolves, type GroundArtifact, type LineContext } from './ground';
import type { StageDeps } from './index';

export interface GateArtifact { checks: { name: string; pass: boolean; reasons: string[] }[] }

type Check = GateArtifact['checks'][number];

const MAX_REASONS = 20;
const REASON_CHARS = 200;

const ReviewArtifact = z.object({ findings: z.array(Finding) });

const check = (name: string, reasons: string[]): Check => ({ name, pass: reasons.length === 0, reasons: reasons.slice(0, MAX_REASONS) });

/** Every string inside a value: all a scene can put on screen or have spoken. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/**
 * No line without evidence in the final storyboard. The schema refuses a line with no reference and a spoken scene
 * with no line; every reference is then resolved against the record again, with numbers held to the facts computed
 * from the sessions rather than to the ones the storyboard carries.
 */
function grounding(storyboard: unknown, ingest: IngestArtifact): Check {
  const parsed = Storyboard.safeParse(storyboard);
  if (!parsed.success) return check('grounding', ['the storyboard is not valid: a line without evidence, or a spoken scene without a line']);
  const record: LineContext = { sessions: ingest.sessions, facts: computeFacts(ingest.sessions), diffs: ingest.diffs };
  return check(
    'grounding',
    parsed.data.scenes.flatMap((scene) =>
      scene.lines.flatMap((line) => {
        const result = scene.type === 'flag' ? evidenceResolves(line, record) : checked(line, record, { skipStyle: true });
        return result.reasons.map((reason) => `${scene.id}/${line.id}: ${reason}`);
      }),
    ),
  );
}

/** The redactor finds nothing in any on-screen string or line. A reason names the scene, never what was found in it. */
function secrets(storyboard: Storyboard): Check {
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  const reasons = scenes.flatMap((scene) => {
    const hits = strings(scene).reduce((n, text) => n + redact(text).hits, 0);
    return hits === 0 ? [] : [`scene ${oneLine(String(scene.id), 40)}: ${hits} secret-shaped string${hits === 1 ? '' : 's'}`];
  });
  const inRepo = redact(String(storyboard.repo)).hits;
  return check('secrets', inRepo === 0 ? reasons : [...reasons, `repository name: ${inRepo} secret-shaped string${inRepo === 1 ? '' : 's'}`]);
}

/** The meter starts from zero after a restart, so the spend recorded against the run counts as well. */
function cost(metered: number, ctx: StageContext): Check {
  const spent = Math.max(metered, ctx.run.costUsd);
  const limit = ctx.run.budget.maxCostPerReelUsd;
  return check('cost', spent <= limit ? [] : [`spent $${spent.toFixed(4)} of a $${limit.toFixed(2)} budget`]);
}

/** No high-severity finding. Only a run without a review stage has no artifact; one that cannot be read fails. */
function review(ctx: StageContext): Check {
  let artifact: unknown;
  try {
    artifact = ctx.read('review');
  } catch (err) {
    if (err instanceof Error && !(err instanceof SyntaxError) && err.message.startsWith('artifact not found')) return { name: 'review', pass: true, reasons: ['review skipped'] };
    return check('review', ['the review artifact could not be read']);
  }
  const parsed = ReviewArtifact.safeParse(artifact);
  if (!parsed.success) return check('review', ['the review artifact could not be read']);
  return check('review', parsed.data.findings.filter((f) => f.severity === 'high').map((f) => oneLine(`${f.sceneId ?? 'reel'}: ${f.issue}`, REASON_CHARS)));
}

export function gateStage(deps: StageDeps): Stage<GateArtifact> {
  return {
    name: 'gate',
    maxAttempts: 1,
    async run(ctx) {
      const { storyboard } = ctx.read<GroundArtifact>('ground');
      const ingest = ctx.read<IngestArtifact>('ingest');

      let checks: Check[] = [];
      await guard('publish_gate', async () => {
        checks = [grounding(storyboard, ingest), secrets(storyboard), cost(deps.meter.total(), ctx), review(ctx)];
        return { pass: checks.every((c) => c.pass), reasons: checks.flatMap((c) => (c.pass ? [] : c.reasons.map((reason) => `${c.name}: ${reason}`))) };
      });

      const failed = checks.filter((c) => !c.pass).map((c) => c.name);
      ctx.log(checks.map((c) => `${c.name} ${c.pass ? 'passed' : 'failed'}`).join(', '));
      return {
        artifact: { checks },
        final: failed.length === 0 ? { status: 'needs_approval', reason: 'awaiting human approval' } : { status: 'blocked', reason: failed.join(', ') },
      };
    },
  };
}
