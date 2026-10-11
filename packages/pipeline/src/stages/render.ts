import { join } from 'node:path';
import type { RenderArtifact } from '@dailies/core';
import type { Stage } from '../types';
import type { GroundArtifact } from './ground';
import type { VoiceArtifact } from './voice';

export function renderStage(): Stage<RenderArtifact> {
  return {
    name: 'render',
    maxAttempts: 2,
    async run(ctx) {
      // The grounded storyboard, never the script draft: a line grounding cut must not reach the screen.
      const { storyboard } = ctx.read<GroundArtifact>('ground');
      const voice = ctx.read<VoiceArtifact>('voice');

      // Loaded when a reel is rendered: the bundler and the renderer are heavy, and most importers of this package never render.
      const { renderReel } = await import('@dailies/reel');
      const artifact = await renderReel({ storyboard, timings: voice.timings, audioPath: voice.audioPath, outDir: join(ctx.runDir, 'reel') });

      ctx.log(`rendered ${artifact.durationSec.toFixed(1)} s as a ${voice.mode} cut`);
      return { artifact };
    },
  };
}
