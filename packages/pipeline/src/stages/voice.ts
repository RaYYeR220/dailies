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
      const artifact: VoiceArtifact =
        deps.tts === null
          ? { mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 }
          : await voiceLines(lines, { provider: deps.tts, voice: deps.voice, outDir: join(ctx.runDir, 'voice'), maxCalls: ctx.run.budget.maxTtsCalls });

      ctx.log(`${artifact.mode} cut, ${lines.length} lines, ${artifact.calls} TTS calls`);
      return { artifact };
    },
  };
}
