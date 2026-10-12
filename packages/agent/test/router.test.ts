import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@dailies/core';
import { CostMeter } from '../src/meter';
import { createRouter, estimateCostUsd } from '../src/router';

type FetchArgs = [string | URL, RequestInit | undefined];

function requestedModel(init: RequestInit | undefined): string {
  return JSON.parse(String(init!.body)).model as string;
}

function completionResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'cmpl_1',
      object: 'chat.completion',
      created: 0,
      model: 'whatever',
      choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const ENV: Env = {
  neatlogsApiKey: null,
  neatlogsEndpoint: 'https://ingest.neatlogs.com',
  gatewayKey: 'key',
  gatewayBaseUrl: 'https://gateway.example/v1',
  veniceKey: null,
  geminiKeys: [],
  dataDir: '/tmp/dailies-router-test',
};

describe('createRouter model selection', () => {
  afterEach(() => {
    delete process.env.DAILIES_MODEL_EDITOR;
    vi.unstubAllGlobals();
  });

  it('defaults the editor role to claude-haiku', async () => {
    let requested = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        requested = requestedModel(args[1]);
        return completionResponse();
      }),
    );
    const router = createRouter(ENV, new CostMeter(10));

    await router.complete({ role: 'editor', messages: [{ role: 'user', content: 'hi' }] });

    expect(requested).toBe('claude-haiku');
  });

  it('honours DAILIES_MODEL_EDITOR over the default', async () => {
    process.env.DAILIES_MODEL_EDITOR = 'claude-opus-override';
    let requested = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        requested = requestedModel(args[1]);
        return completionResponse();
      }),
    );
    const router = createRouter(ENV, new CostMeter(10));

    await router.complete({ role: 'editor', messages: [{ role: 'user', content: 'hi' }] });

    expect(requested).toBe('claude-opus-override');
  });

  it('leaves other roles on their own default when only DAILIES_MODEL_EDITOR is set', async () => {
    process.env.DAILIES_MODEL_EDITOR = 'claude-opus-override';
    let requested = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (...args: FetchArgs) => {
        requested = requestedModel(args[1]);
        return completionResponse();
      }),
    );
    const router = createRouter(ENV, new CostMeter(10));

    await router.complete({ role: 'judge', messages: [{ role: 'user', content: 'hi' }] });

    expect(requested).toBe('nova-pro');
  });
});

describe('estimateCostUsd', () => {
  it('prices known models from the per-million-token table', () => {
    expect(estimateCostUsd('claude-sonnet-4.6', 1_000_000, 1_000_000)).toBeCloseTo(3 + 15);
    expect(estimateCostUsd('claude-haiku', 1_000_000, 1_000_000)).toBeCloseTo(1 + 5);
    expect(estimateCostUsd('nova-pro', 1_000_000, 1_000_000)).toBeCloseTo(0.8 + 3.2);
  });

  it('falls back to a conservative non-zero estimate for an unpriced model, so budget tracking fails closed', () => {
    const cost = estimateCostUsd('some-unlisted-venice-model', 1_000_000, 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });
});
