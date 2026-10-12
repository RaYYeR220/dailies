import type { CostMeter, ModelClient, NeatlogsMcp } from '@dailies/agent';
import type { TtsProvider } from '@dailies/voice';
import { addCost } from '../store';
import type { Database, Stage } from '../types';
import { editStage } from './edit';
import { gateStage } from './gate';
import { groundStage } from './ground';
import { ingestStage } from './ingest';
import { renderStage } from './render';
import { reviewStage } from './review';
import { scriptStage } from './script';
import { verifyStage } from './verify';
import { voiceStage } from './voice';

export type { EditArtifact } from './edit';
export type { VerifyArtifact } from './verify';
export type { ScriptArtifact } from './script';
export type { GroundArtifact } from './ground';
export type { VoiceArtifact } from './voice';
export type { GateArtifact } from './gate';
export { reviewStage } from './review';

export interface StageDeps { db: Database; client: ModelClient; meter: CostMeter; tts: TtsProvider | null; voice: string; maxSessions?: number; mcp?: NeatlogsMcp | null; noReview?: boolean }

/**
 * The stage, with whatever it adds to the meter recorded against the run. A failed attempt is recorded too:
 * the money is spent whether or not the stage returns.
 */
export function recordSpend<T>(deps: Pick<StageDeps, 'db' | 'meter'>, stage: Stage<T>): Stage<T> {
  return {
    ...stage,
    async run(ctx) {
      const before = deps.meter.total();
      try {
        return await stage.run(ctx);
      } finally {
        const spent = deps.meter.total() - before;
        if (spent > 0) addCost(deps.db, ctx.run.id, spent);
      }
    },
  };
}

/** ingest, edit, verify, script, ground, voice, render, review, gate — review left out when `deps.noReview` is set. */
export function buildStages(deps: StageDeps): Stage[] {
  const stages: Stage[] = [ingestStage(deps), editStage(deps), verifyStage(deps), scriptStage(deps), groundStage(deps), voiceStage(deps), renderStage()];
  if (!deps.noReview) stages.push(reviewStage(deps));
  stages.push(gateStage(deps));
  return stages.map((stage) => recordSpend(deps, stage));
}
