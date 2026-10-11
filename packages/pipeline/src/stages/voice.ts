import { join } from 'node:path';
import type { LineTiming } from '@dailies/core';
import { estimateTimings, voiceLines } from '@dailies/voice';
import type { Stage } from '../types';
import type { GroundArtifact } from './ground';
import type { StageDeps } from './index';

export interface VoiceArtifact { mode: 'voiced' | 'captions'; audioPath: string | null; timings: LineTiming[]; calls: number }

export function voiceStage(deps: StageDeps): Stage<VoiceArtifact> {
  return {
    name: 'voice',
    maxAttempts: 3,
    async run(ctx) {
      // Only what grounding let through is ever spoken.
      const { storyboard } = ctx.read<GroundArtifact>('ground');
      const lines = storyboard.scenes.flatMap((scene) => scene.lines.map((line) => ({ id: line.id, text: line.text })));

      // `voiceLines` needs a provider, so the cut without one is made here, the way it makes its own.
      // `voiceLines` itself only falls back for a quota error; any other provider failure (a network
      // error, a bad key, a provider outage) must not fail the whole run after retries, so it is caught
      // here and turned into the same captions-only cut the spec promises for a text-to-speech failure.
      let artifact: VoiceArtifact;
      if (deps.tts === null) {
        artifact = { mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 };
      } else {
        try {
          artifact = await voiceLines(lines, { provider: deps.tts, voice: deps.voice, outDir: join(ctx.runDir, 'voice'), maxCalls: ctx.run.budget.maxTtsCalls });
        } catch (err) {
          ctx.log(`text-to-speech failed, continuing in captions mode: ${err instanceof Error ? err.message : String(err)}`);
          artifact = { mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 };
        }
      }

      ctx.log(`${artifact.mode} cut, ${lines.length} lines, ${artifact.calls} TTS calls`);
      return { artifact };
    },
  };
}
