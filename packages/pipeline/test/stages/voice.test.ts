import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { estimateTimings, TtsQuotaError, type TtsProvider } from '@dailies/voice';
import { voiceStage } from '../../src/stages/voice';
import { cleanup, groundArtifact, harness, scriptArtifact } from './fixture';

afterEach(cleanup);

const GROUNDED = [
  'The session opened with a request to retry failed jobs.',
  'The retry lives in the run method of the queue.',
  'The queue test run failed on the retry count.',
  'The agent wrote: "All tests pass and the build is green."',
  'The last test run before that message had failed.',
  'In the second session all 3 tests passed.',
  'The window holds 2 sessions and 2 commits.',
];

/** A provider that records what it was asked to say. */
function provider(synthesize: () => { pcm: Buffer; sampleRate: number }) {
  const asked: { text: string; voice: string }[] = [];
  const tts: TtsProvider = {
    name: 'fake',
    synthesize: async (text, voice) => {
      asked.push({ text, voice });
      return synthesize();
    },
  };
  return { tts, asked };
}

/** The ground artifact, and a script artifact holding a line that grounding would have cut. */
async function artifacts() {
  const script = await scriptArtifact();
  script.storyboard.scenes[1]!.lines[0]!.text = 'A line that did not survive grounding.';
  return { ground: await groundArtifact(), script };
}

describe('voice stage', () => {
  it('voice makes a captions cut when there is no TTS provider', async () => {
    const h = harness({ artifacts: await artifacts(), tts: null });

    const { artifact } = await voiceStage(h.deps).run(h.ctx());

    const ids = ['l1', 'l2', 'l3', 'flag_c_1_quote', 'flag_c_1_reality', 'l4', 'l5'];
    expect(artifact).toEqual({ mode: 'captions', audioPath: null, timings: estimateTimings(ids.map((id, n) => ({ id, text: GROUNDED[n]! }))), calls: 0 });
    expect(artifact.timings.map((t) => t.lineId)).toEqual(ids);
  });

  it('voice speaks the lines of the grounded storyboard, in order, in the configured voice', async () => {
    const { tts, asked } = provider(() => {
      throw new TtsQuotaError('quota exhausted');   // the text reached the provider; what comes back is not the point here
    });
    const h = harness({ artifacts: await artifacts(), tts });

    const { artifact } = await voiceStage(h.deps).run(h.ctx());

    expect(asked).toHaveLength(1);
    expect(asked[0]!.voice).toBe('Charon');
    const positions = GROUNDED.map((line) => asked[0]!.text.indexOf(line));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(asked[0]!.text).not.toContain('did not survive grounding');
    expect(artifact.mode).toBe('captions');   // voiceLines falls back when the quota is gone
  });

  it('voice falls back to a captions cut, with estimated timings, when the provider fails with something other than quota', async () => {
    const { tts, asked } = provider(() => {
      throw new Error('network error: ECONNRESET');
    });
    const h = harness({ artifacts: await artifacts(), tts });

    const { artifact } = await voiceStage(h.deps).run(h.ctx());

    expect(asked).toHaveLength(1);
    const ids = ['l1', 'l2', 'l3', 'flag_c_1_quote', 'flag_c_1_reality', 'l4', 'l5'];
    expect(artifact).toEqual({ mode: 'captions', audioPath: null, timings: estimateTimings(ids.map((id, n) => ({ id, text: GROUNDED[n]! }))), calls: 0 });
    expect(h.events.some((e) => e.includes('ECONNRESET'))).toBe(true);
  });

  it('voice makes no TTS call when the run budget allows none', async () => {
    const { tts, asked } = provider(() => ({ pcm: Buffer.alloc(0), sampleRate: 24000 }));
    const h = harness({ artifacts: await artifacts(), tts, budget: { maxCostPerReelUsd: 0.6, maxTtsCalls: 0, maxRenderSec: 300 } });

    const { artifact } = await voiceStage(h.deps).run(h.ctx());

    expect(asked).toEqual([]);
    expect(artifact).toMatchObject({ mode: 'captions', audioPath: null, calls: 0 });
  });

  it('voice writes the narration under the run directory and times every line', async () => {
    const { tts } = provider(() => ({ pcm: Buffer.alloc(24000 * 2 * 7), sampleRate: 24000 }));   // 7 seconds of silence
    const h = harness({ artifacts: await artifacts(), tts });
    const ctx = h.ctx();

    const { artifact } = await voiceStage(h.deps).run(ctx);

    expect(artifact.mode).toBe('voiced');
    expect(artifact.calls).toBe(1);
    expect(artifact.audioPath).toBe(join(ctx.runDir, 'voice', 'narration.wav'));
    expect(existsSync(artifact.audioPath!)).toBe(true);
    expect(artifact.timings).toHaveLength(7);
    expect(artifact.timings.at(-1)!.endSec).toBeCloseTo(7, 1);
  });
});
