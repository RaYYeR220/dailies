import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineTiming, Storyboard } from '@dailies/core';
import { renderStage } from '../../src/stages/render';
import { cleanup, groundArtifact, harness, scriptArtifact } from './fixture';

// The renderer itself is covered in @dailies/reel and by the end-to-end run; here it is the stage's wiring that counts.
const rendered: { storyboard: Storyboard; timings: LineTiming[]; audioPath: string | null; outDir: string }[] = [];
vi.mock('@dailies/reel', () => ({
  renderReel: async (input: (typeof rendered)[number]) => {
    rendered.push(input);
    return { videoPath: join(input.outDir, 'reel.mp4'), srtPath: join(input.outDir, 'reel.srt'), posterPath: join(input.outDir, 'poster.png'), durationSec: 31.5 };
  },
}));

afterEach(() => {
  cleanup();
  rendered.length = 0;
});

describe('render stage', () => {
  it('render renders the grounded storyboard, never the script draft, with the voice stage timings into <runDir>/reel', async () => {
    const script = await scriptArtifact();
    script.storyboard.scenes[1]!.lines[0]!.text = 'A line that did not survive grounding.';
    const ground = await groundArtifact();
    const timings = ground.storyboard.scenes.flatMap((s) => s.lines).map((l, n) => ({ lineId: l.id, startSec: n * 4, endSec: n * 4 + 4 }));
    const voice = { mode: 'voiced', audioPath: '/tmp/run/voice/narration.wav', timings, calls: 1 };
    const h = harness({ artifacts: { script, ground, voice } });
    const ctx = h.ctx();

    const { artifact } = await renderStage().run(ctx);

    const outDir = join(ctx.runDir, 'reel');
    expect(rendered).toEqual([{ storyboard: ground.storyboard, timings, audioPath: '/tmp/run/voice/narration.wav', outDir }]);
    expect(artifact).toEqual({ videoPath: join(outDir, 'reel.mp4'), srtPath: join(outDir, 'reel.srt'), posterPath: join(outDir, 'poster.png'), durationSec: 31.5 });
  });

  it('render makes a captions cut when the voice stage has no audio', async () => {
    const ground = await groundArtifact();
    const h = harness({ artifacts: { ground, voice: { mode: 'captions', audioPath: null, timings: [], calls: 0 } } });

    await renderStage().run(h.ctx());

    expect(rendered[0]!.audioPath).toBeNull();
  });
});
