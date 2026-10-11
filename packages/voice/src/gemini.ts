export interface TtsProvider {
  name: string;
  synthesize(text: string, voice: string): Promise<{ pcm: Buffer; sampleRate: number }>;
}

export class TtsQuotaError extends Error {}

const DEFAULT_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGeminiTts(keys: string[], o?: { models?: string[]; fetchImpl?: typeof fetch }): TtsProvider {
  const models = o?.models ?? DEFAULT_MODELS;
  const fetchImpl = o?.fetchImpl ?? fetch;

  return {
    name: 'gemini',
    async synthesize(text, voice) {
      for (const model of models) {
        for (const key of keys) {
          const result = await requestOnce(fetchImpl, model, key, text, voice);
          if (result) return result;
        }
      }
      throw new TtsQuotaError(`gemini tts: exhausted ${keys.length} key(s) across ${models.length} model(s)`);
    },
  };
}

async function requestOnce(
  fetchImpl: typeof fetch,
  model: string,
  key: string,
  text: string,
  voice: string,
): Promise<{ pcm: Buffer; sampleRate: number } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body,
    });

    if (res.status === 429) return null;
    if (res.status >= 500 && attempt < 2) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      candidates: [{ content: { parts: [{ inlineData: { data: string; mimeType?: string } }] } }];
    };
    const inline = data.candidates[0].content.parts[0].inlineData;
    const rateMatch = /rate=(\d+)/.exec(inline.mimeType ?? '');
    return { pcm: Buffer.from(inline.data, 'base64'), sampleRate: rateMatch ? Number(rateMatch[1]) : 24000 };
  }
}
