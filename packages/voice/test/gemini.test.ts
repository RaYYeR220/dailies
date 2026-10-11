import { describe, it, expect, vi } from 'vitest';
import { createGeminiTts, TtsQuotaError } from '../src/gemini';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function audioBody(dataB64: string, mimeType = 'audio/L16;rate=24000') {
  return { candidates: [{ content: { parts: [{ inlineData: { data: dataB64, mimeType } }] } }] };
}

describe('createGeminiTts', () => {
  it('rotates to the next key on 429 and to the next model when all keys fail', async () => {
    const calls: { model: string; key: string }[] = [];
    const pcmB64 = Buffer.from([1, 2, 3, 4]).toString('base64');

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const model = /models\/([^:]+):/.exec(String(url))![1]!;
      const key = (init!.headers as Record<string, string>)['x-goog-api-key']!;
      calls.push({ model, key });
      if (model === 'm1') return jsonResponse(429, {});
      return jsonResponse(200, audioBody(pcmB64));
    });

    const provider = createGeminiTts(['k1', 'k2'], { models: ['m1', 'm2'], fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await provider.synthesize('hello', 'Kore');

    expect(result.pcm).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(result.sampleRate).toBe(24000);
    expect(calls).toEqual([
      { model: 'm1', key: 'k1' },
      { model: 'm1', key: 'k2' },
      { model: 'm2', key: 'k1' },
    ]);
  });

  it('throws TtsQuotaError when every key and model is exhausted', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, {}));
    const provider = createGeminiTts(['k1'], { models: ['m1', 'm2'], fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.synthesize('hello', 'Kore')).rejects.toBeInstanceOf(TtsQuotaError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('defaults the sample rate to 24000 when the mimeType has no rate', async () => {
    const pcmB64 = Buffer.from([9, 9]).toString('base64');
    const fetchImpl = vi.fn(async () => jsonResponse(200, audioBody(pcmB64, 'audio/L16')));
    const provider = createGeminiTts(['k1'], { fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.synthesize('hi', 'Kore');
    expect(result.sampleRate).toBe(24000);
  });

  it('retries a 5xx twice with a backoff before succeeding on the same key', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const pcmB64 = Buffer.from([7]).toString('base64');
      const fetchImpl = vi.fn(async () => {
        n += 1;
        if (n < 3) return jsonResponse(503, {});
        return jsonResponse(200, audioBody(pcmB64));
      });
      const provider = createGeminiTts(['k1'], { fetchImpl: fetchImpl as unknown as typeof fetch });

      const resultPromise = provider.synthesize('hi', 'Kore');
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      expect(n).toBe(3);
      expect(result.pcm).toEqual(Buffer.from([7]));
    } finally {
      vi.useRealTimers();
    }
  });
});
