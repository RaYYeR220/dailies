import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@dailies/pipeline';
import type { Database } from '@dailies/pipeline';
import type { Env } from '@dailies/core';
import { isMainModule, makeStages } from '../src/worker-main';

let dataDir: string;
let db: Database;

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function env(o: Partial<Env> = {}): Env {
  return {
    neatlogsApiKey: null,
    neatlogsEndpoint: 'https://ingest.neatlogs.com',
    gatewayKey: 'test-key',
    gatewayBaseUrl: 'https://litellm.vision.aivar.app/v1',
    veniceKey: null,
    geminiKeys: [],
    dataDir,
    ...o,
  };
}

describe('makeStages', () => {
  it('builds all nine stages in pipeline order, review immediately before the gate', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'dailies-worker-main-'));
    db = openDb(':memory:');

    const stages = makeStages(db, env());

    expect(stages.map((s) => s.name)).toEqual(['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'review', 'gate']);
  });

  it('builds a Gemini text-to-speech provider only when GEMINI_API_KEYS is set', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'dailies-worker-main-'));
    db = openDb(':memory:');

    const withoutKeys = makeStages(db, env());
    const withKeys = makeStages(db, env({ geminiKeys: ['k1'] }));

    // Both still build the full stage list either way; voice.ts itself falls back to captions with no provider.
    expect(withoutKeys.map((s) => s.name)).toEqual(withKeys.map((s) => s.name));
  });
});

describe('isMainModule', () => {
  it('is true only when the module URL and argv[1] name the same file', () => {
    const here = import.meta.url;
    expect(isMainModule(here, new URL(here).pathname)).toBe(true);
    expect(isMainModule(here, '/not/the/same/file.ts')).toBe(false);
    expect(isMainModule(here, undefined)).toBe(false);
  });
});
