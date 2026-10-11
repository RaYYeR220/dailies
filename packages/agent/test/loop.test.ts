import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ChatMessage } from '../src/router';
import { createMockClient } from '../src/mock';
import { defineTool } from '../src/tools';
import { completeJson, runAgent, AgentStepLimitError, ModelOutputError } from '../src/loop';

describe('completeJson', () => {
  it('completeJson parses fenced JSON', async () => {
    const client = createMockClient(() => ({ role: 'assistant', content: '```json\n{"n":2}\n```' }));
    await expect(
      completeJson({ client, role: 'extractor', name: 't', system: 's', user: 'u', output: z.object({ n: z.number() }) }),
    ).resolves.toEqual({ n: 2 });
  });

  it('completeJson sends one repair turn then throws ModelOutputError', async () => {
    let calls = 0;
    const client = createMockClient(() => {
      calls += 1;
      return { role: 'assistant', content: 'not json' };
    });
    await expect(
      completeJson({ client, role: 'extractor', name: 't', system: 's', user: 'u', output: z.object({ n: z.number() }) }),
    ).rejects.toBeInstanceOf(ModelOutputError);
    expect(calls).toBe(2);
  });
});

describe('runAgent', () => {
  it('runAgent executes a tool call and returns the final JSON', async () => {
    const add = defineTool({
      name: 'add',
      description: 'adds two numbers',
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ sum: a + b }),
    });

    let call = 0;
    const client = createMockClient(() => {
      call += 1;
      if (call === 1) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call1', type: 'function', function: { name: 'add', arguments: JSON.stringify({ a: 2, b: 3 }) } }],
        };
      }
      return { role: 'assistant', content: '{"sum":5}' };
    });

    const result = await runAgent({
      client,
      role: 'editor',
      name: 't',
      system: 's',
      user: 'u',
      tools: [add],
      output: z.object({ sum: z.number() }),
    });

    expect(result.output).toEqual({ sum: 5 });
    expect(result.steps).toBe(2);
  });

  it('runAgent returns tool errors to the model instead of throwing', async () => {
    const boom = defineTool({
      name: 'boom',
      description: 'always fails',
      parameters: z.object({}),
      execute: async () => {
        throw new Error('kaboom');
      },
    });

    let call = 0;
    let secondRequestMessages: ChatMessage[] = [];
    const client = createMockClient((req) => {
      call += 1;
      if (call === 1) {
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'boom', arguments: '{}' } }],
        };
      }
      secondRequestMessages = req.messages;
      return { role: 'assistant', content: '{"n":1}' };
    });

    const result = await runAgent({
      client,
      role: 'editor',
      name: 't',
      system: 's',
      user: 'u',
      tools: [boom],
      output: z.object({ n: z.number() }),
    });

    expect(result.output).toEqual({ n: 1 });
    const toolMessage = secondRequestMessages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('{"error":');
    expect(toolMessage?.content).toContain('kaboom');
  });

  it('runAgent throws AgentStepLimitError after maxSteps', async () => {
    const noop = defineTool({
      name: 'noop',
      description: 'never resolves the task',
      parameters: z.object({}),
      execute: async () => ({}),
    });
    const client = createMockClient(() => ({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'noop', arguments: '{}' } }],
    }));

    await expect(
      runAgent({ client, role: 'editor', name: 't', system: 's', user: 'u', tools: [noop], output: z.object({}), maxSteps: 2 }),
    ).rejects.toBeInstanceOf(AgentStepLimitError);
  });
});
