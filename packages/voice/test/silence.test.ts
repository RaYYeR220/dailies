import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSilences } from '../src/silence';

const execFileAsync = promisify(execFile);

async function makeClip(path: string, args: string[]): Promise<void> {
  await execFileAsync('ffmpeg', ['-y', ...args, '-ar', '24000', '-ac', '1', '-sample_fmt', 's16', '-c:a', 'pcm_s16le', path]);
}

describe('detectSilences', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('detects the pause in a generated clip', async () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-silence-'));
    const clipPath = join(dir, 'clip.wav');
    // 1s sine, 0.8s digital silence, 1s sine.
    await makeClip(clipPath, [
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono:d=0.8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]',
      '-map', '[out]',
    ]);

    const silences = await detectSilences(clipPath);

    const pause = silences.find((s) => s.start > 0.9 && s.start < 1.1);
    expect(pause).toBeDefined();
    expect(pause!.end).toBeGreaterThan(1.7);
    expect(pause!.end).toBeLessThan(1.9);
  });

  it('returns no silences for a clip with no pause', async () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-silence-'));
    const clipPath = join(dir, 'clip.wav');
    await makeClip(clipPath, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1']);

    const silences = await detectSilences(clipPath);
    expect(silences).toEqual([]);
  });
});
