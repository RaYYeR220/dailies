import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '@dailies/core';
import { createRouter } from '../src/router';
import { CostMeter } from '../src/meter';
import { defineTool } from '../src/tools';
import { completeJson, runAgent } from '../src/loop';
import { initTracing, shutdownTracing } from '../src/trace';

const env = loadEnv();
const hasKey = Boolean(process.env.LITELLM_API_KEY);

describe.skipIf(!hasKey)('live gateway smoke test', () => {
  it('completeJson and runAgent reach the real gateway and the meter records cost', async () => {
    await initTracing(env, 'dailies-agent-live-test');
    const meter = new CostMeter(0.6);
    const client = createRouter(env, meter);

    const extracted = await completeJson({
      client,
      role: 'extractor',
      name: 'live-smoke-extractor',
      system: 'Reply with JSON only.',
      user: 'Reply with the JSON object {"ok":true} and nothing else.',
      output: z.object({ ok: z.boolean() }),
    });
    expect(extracted).toEqual({ ok: true });

    const add = defineTool({
      name: 'add',
      description: 'adds two integers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ sum: a + b }),
    });
    const agentResult = await runAgent({
      client,
      role: 'editor',
      name: 'live-smoke-agent',
      system: 'Use the add tool to add the two numbers, then reply with JSON only: {"sum": <result>}.',
      user: 'What is 19 plus 23? Use the add tool.',
      tools: [add],
      output: z.object({ sum: z.number() }),
    });
    expect(agentResult.output.sum).toBe(42);

    expect(meter.total()).toBeGreaterThan(0);
    await shutdownTracing();
  });
});
