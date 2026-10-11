import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWav } from '../src/wav';

describe('writeWav', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid 44-byte WAV header', () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-wav-'));
    const path = join(dir, 'out.wav');
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const sampleRate = 24000;

    writeWav(path, pcm, sampleRate);
    const buf = readFileSync(path);

    expect(buf.length).toBe(44 + pcm.length);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ');
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(28)).toBe(sampleRate * 2); // byte rate
    expect(buf.readUInt32LE(40)).toBe(pcm.length); // data chunk size
    expect(buf.subarray(44)).toEqual(pcm);
  });

  it('creates missing parent directories', () => {
    dir = mkdtempSync(join(tmpdir(), 'voice-wav-'));
    const path = join(dir, 'nested', 'deep', 'out.wav');
    writeWav(path, Buffer.from([0, 0]), 16000);
    expect(readFileSync(path).length).toBe(46);
  });
});
