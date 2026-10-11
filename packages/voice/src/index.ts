import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LineTiming } from '@dailies/core';
import { TtsQuotaError, type TtsProvider } from './gemini';
import { writeWav } from './wav';
import { detectSilences } from './silence';
import { alignLines, estimateTimings } from './align';

export * from './gemini';
export * from './wav';
export * from './silence';
export * from './align';

const NARRATOR_PREFIX = 'Read as a calm, dry documentary narrator. Pause for a full second between paragraphs.\n\n';

export async function voiceLines(
  lines: { id: string; text: string }[],
  o: { provider: TtsProvider; voice: string; outDir: string; maxCalls: number },
): Promise<{ mode: 'voiced' | 'captions'; audioPath: string | null; timings: LineTiming[]; calls: number }> {
  if (o.maxCalls <= 0) {
    return { mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 };
  }

  const joinedText = NARRATOR_PREFIX + lines.map((l) => l.text).join('\n\n');
  const hash = createHash('sha256').update(`${o.provider.name}\n${o.voice}\n${joinedText}`).digest('hex');
  const cachePath = join(o.outDir, 'cache', `${hash}.wav`);
  const audioPath = join(o.outDir, 'narration.wav');

  let calls = 0;
  if (existsSync(cachePath)) {
    mkdirSync(dirname(audioPath), { recursive: true });
    copyFileSync(cachePath, audioPath);
  } else {
    let pcm: Buffer;
    let sampleRate: number;
    try {
      const synthesized = await o.provider.synthesize(joinedText, o.voice);
      pcm = synthesized.pcm;
      sampleRate = synthesized.sampleRate;
    } catch (err) {
      if (err instanceof TtsQuotaError) {
        return { mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 };
      }
      throw err;
    }
    calls = 1;
    writeWav(cachePath, pcm, sampleRate);
    writeWav(audioPath, pcm, sampleRate);
  }

  const durationSec = readWavDurationSec(audioPath);
  const silences = await detectSilences(audioPath);
  const timings = alignLines(lines, durationSec, silences);
  return { mode: 'voiced', audioPath, timings, calls };
}

function readWavDurationSec(path: string): number {
  const buf = readFileSync(path);
  const sampleRate = buf.readUInt32LE(24);
  const dataSize = buf.readUInt32LE(40);
  return dataSize / (sampleRate * 2);
}
