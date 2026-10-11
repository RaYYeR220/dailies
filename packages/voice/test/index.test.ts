import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voiceLines, TtsQuotaError, estimateTimings, type TtsProvider } from '../src/index';

function silentPcm(seconds: number, sampleRate = 24000): Buffer {
  return Buffer.alloc(Math.round(seconds * sampleRate) * 2);
}

describe('voiceLines', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('returns captions mode with estimated timings when maxCalls is zero', async () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-lines-'));
    const lines = [{ id: 'a', text: 'Hello there.' }, { id: 'b', text: 'Goodbye now.' }];
    let called = false;
    const provider: TtsProvider = {
      name: 'mock',
      synthesize: async () => {
        called = true;
        return { pcm: Buffer.alloc(0), sampleRate: 24000 };
      },
    };

    const result = await voiceLines(lines, { provider, voice: 'Kore', outDir: dir, maxCalls: 0 });

    expect(called).toBe(false);
    expect(result).toEqual({ mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 });
  });

  it('returns captions mode with estimated timings on TtsQuotaError', async () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-lines-'));
    const lines = [{ id: 'a', text: 'Hello there.' }];
    const provider: TtsProvider = {
      name: 'mock',
      synthesize: async () => {
        throw new TtsQuotaError('quota exhausted');
      },
    };

    const result = await voiceLines(lines, { provider, voice: 'Kore', outDir: dir, maxCalls: 1 });

    expect(result).toEqual({ mode: 'captions', audioPath: null, timings: estimateTimings(lines), calls: 0 });
  });

  it('reuses the cache and makes zero calls the second time', async () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-lines-'));
    const lines = [{ id: 'a', text: 'Hello there.' }, { id: 'b', text: 'Goodbye now.' }];
    let calls = 0;
    const provider: TtsProvider = {
      name: 'mock',
      synthesize: async () => {
        calls += 1;
        return { pcm: silentPcm(2), sampleRate: 24000 };
      },
    };

    const first = await voiceLines(lines, { provider, voice: 'Kore', outDir: dir, maxCalls: 1 });
    expect(first.mode).toBe('voiced');
    expect(first.calls).toBe(1);
    expect(calls).toBe(1);
    expect(first.audioPath).not.toBeNull();
    expect(existsSync(first.audioPath!)).toBe(true);
    expect(first.timings).toHaveLength(2);

    const second = await voiceLines(lines, { provider, voice: 'Kore', outDir: dir, maxCalls: 1 });
    expect(second.mode).toBe('voiced');
    expect(second.calls).toBe(0);
    expect(calls).toBe(1);
    expect(second.audioPath).toBe(first.audioPath);
  });
});
