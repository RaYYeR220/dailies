import OpenAI from 'openai';
import { wrapOpenAI } from 'neatlogs';
import { z } from 'zod';
import type { Env } from '@dailies/core';
import type { CostMeter } from './meter';
import { sharedLimiter } from './limiter';
import type { Tool } from './tools';
import { isTracingInitialized } from './trace';

export type Role = 'editor' | 'extractor' | 'judge' | 'writer' | 'vision';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Completion {
  message: ChatMessage;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

export interface ModelClient {
  complete(req: { role: Role; messages: ChatMessage[]; tools?: Tool[]; maxTokens?: number }): Promise<Completion>;
}

const MODEL_BY_ROLE: Record<Role, string> = {
  editor: 'claude-sonnet-4.6',
  writer: 'claude-sonnet-4.6',
  vision: 'claude-sonnet-4.6',
  extractor: 'claude-haiku',
  judge: 'nova-pro',
};

const COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4.6': { input: 3, output: 15 },
  'claude-haiku': { input: 1, output: 5 },
  'nova-pro': { input: 0.8, output: 3.2 },
};

const RETRY_WAITS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: unknown): boolean {
  return status === 429 || (typeof status === 'number' && status >= 500);
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const table = COST_PER_MILLION_TOKENS[model];
  if (!table) return 0;
  return (inputTokens / 1_000_000) * table.input + (outputTokens / 1_000_000) * table.output;
}

function toOpenAiTool(tool: Tool) {
  return {
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.parameters) },
  };
}

function toCompletion(raw: OpenAI.Chat.Completions.ChatCompletion, model: string, provider: string, costUsd: number, meter: CostMeter): Completion {
  const choice = raw.choices[0];
  const inputTokens = raw.usage?.prompt_tokens ?? 0;
  const outputTokens = raw.usage?.completion_tokens ?? 0;
  meter.add(costUsd);
  const toolCalls = choice?.message.tool_calls?.flatMap((tc): ToolCall[] =>
    tc.type === 'function' ? [{ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } }] : [],
  );
  const message: ChatMessage = {
    role: 'assistant',
    content: choice?.message.content ?? null,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
  return { message, inputTokens, outputTokens, model, provider };
}

export function createRouter(env: Env, meter: CostMeter): ModelClient {
  let lastCostHeader: number | null = null;

  const costFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const res = await fetch(input, init);
    const header = res.headers.get('x-litellm-response-cost');
    lastCostHeader = header ? Number(header) : null;
    return res;
  }) as typeof fetch;

  const wrap = (client: OpenAI): OpenAI => (isTracingInitialized() ? wrapOpenAI(client) : client);

  const gatewayClient = wrap(new OpenAI({ baseURL: env.gatewayBaseUrl, apiKey: env.gatewayKey ?? 'unset', fetch: costFetch }));

  async function requestOnce(
    client: OpenAI,
    model: string,
    messages: ChatMessage[],
    tools: Tool[] | undefined,
    maxTokens: number | undefined,
  ): Promise<{ raw: OpenAI.Chat.Completions.ChatCompletion; costUsd: number }> {
    lastCostHeader = null;
    const raw = await client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: tools && tools.length > 0 ? tools.map(toOpenAiTool) : undefined,
      max_tokens: maxTokens,
    });
    const inputTokens = raw.usage?.prompt_tokens ?? 0;
    const outputTokens = raw.usage?.completion_tokens ?? 0;
    const costUsd = lastCostHeader ?? estimateCostUsd(model, inputTokens, outputTokens);
    return { raw, costUsd };
  }

  async function complete(req: { role: Role; messages: ChatMessage[]; tools?: Tool[]; maxTokens?: number }): Promise<Completion> {
    meter.assertWithin();
    await sharedLimiter.acquire();
    const model = MODEL_BY_ROLE[req.role];

    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_WAITS_MS.length; attempt++) {
      try {
        const { raw, costUsd } = await requestOnce(gatewayClient, model, req.messages, req.tools, req.maxTokens);
        return toCompletion(raw, model, 'gateway', costUsd, meter);
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: unknown } | null)?.status;
        if (!isRetryableStatus(status) || attempt === RETRY_WAITS_MS.length) break;
        await sleep(RETRY_WAITS_MS[attempt]!);
      }
    }

    const veniceModel = process.env[`VENICE_MODEL_${req.role.toUpperCase()}`];
    if (env.veniceKey && veniceModel) {
      const veniceClient = wrap(new OpenAI({ baseURL: 'https://api.venice.ai/api/v1', apiKey: env.veniceKey, fetch: costFetch }));
      const { raw, costUsd } = await requestOnce(veniceClient, veniceModel, req.messages, req.tools, req.maxTokens);
      return toCompletion(raw, veniceModel, 'venice', costUsd, meter);
    }
    throw lastErr;
  }

  return { complete };
}
