import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function detectSilences(
  wavPath: string,
  o?: { noiseDb?: number; minSec?: number },
): Promise<{ start: number; end: number }[]> {
  const noiseDb = o?.noiseDb ?? -35;
  const minSec = o?.minSec ?? 0.45;
  const stderr = await runFfmpeg(wavPath, noiseDb, minSec);
  return parsePairs(stderr);
}

async function runFfmpeg(wavPath: string, noiseDb: number, minSec: number): Promise<string> {
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      ['-i', wavPath, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-'],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return stderr;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? '';
  }
}

function parsePairs(stderr: string): { start: number; end: number }[] {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const n = Math.min(starts.length, ends.length);
  const result: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) result.push({ start: starts[i]!, end: ends[i]! });
  return result;
}
