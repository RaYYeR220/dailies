import { z } from 'zod';
import type { ChatMessage, ContentPart, ModelClient, Role } from './router';
import type { Tool } from './tools';
import { traced } from './trace';

export class AgentStepLimitError extends Error {}
export class ModelOutputError extends Error {}

function extractText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return '';
}

function stripFences(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text.trim());
  return (match ? match[1]! : text).trim();
}

function tryParseJson<T>(message: ChatMessage, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  const raw = stripFences(extractText(message.content));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.message };
}

function repairPrompt(zodError: string): string {
  return `Your last reply was not valid JSON for the required schema. Zod error:\n${zodError}\n\nReply with JSON only, no commentary, no code fences.`;
}

async function parseOrRepair<T>(
  client: ModelClient,
  role: Role,
  priorMessages: ChatMessage[],
  first: ChatMessage,
  output: z.ZodType<T>,
  name: string,
): Promise<T> {
  const parsed = tryParseJson(first, output);
  if (parsed.ok) return parsed.value;

  const repairMessages: ChatMessage[] = [...priorMessages, first, { role: 'user', content: repairPrompt(parsed.error) }];
  const second = await client.complete({ role, messages: repairMessages });
  const repaired = tryParseJson(second.message, output);
  if (repaired.ok) return repaired.value;
  throw new ModelOutputError(`${name}: model did not return valid JSON for the expected schema after one repair turn`);
}

export async function completeJson<T>(o: {
  client: ModelClient;
  role: Role;
  name: string;
  system: string;
  user: string | ContentPart[];
  output: z.ZodType<T>;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];
  const first = await o.client.complete({ role: o.role, messages });
  return parseOrRepair(o.client, o.role, messages, first.message, o.output, o.name);
}

export async function runAgent<T>(o: {
  client: ModelClient;
  role: Role;
  name: string;
  system: string;
  user: string;
  tools: Tool[];
  output: z.ZodType<T>;
  maxSteps?: number;
}): Promise<{ output: T; steps: number }> {
  return traced('AGENT', o.name, async () => {
    const maxSteps = o.maxSteps ?? 24;
    const toolByName = new Map(o.tools.map((t) => [t.name, t]));
    const messages: ChatMessage[] = [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ];

    for (let step = 1; step <= maxSteps; step++) {
      const completion = await o.client.complete({ role: o.role, messages, tools: o.tools });
      messages.push(completion.message);

      const calls = completion.message.tool_calls;
      if (!calls || calls.length === 0) {
        const output = await parseOrRepair(o.client, o.role, messages.slice(0, -1), completion.message, o.output, o.name);
        return { output, steps: step };
      }

      for (const call of calls) {
        const resultText = await traced('TOOL', call.function.name, async () => {
          const tool = toolByName.get(call.function.name);
          if (!tool) throw new Error(`unknown tool: ${call.function.name}`);
          const args = JSON.parse(call.function.arguments);
          const parsedArgs = tool.parameters.safeParse(args);
          if (!parsedArgs.success) throw new Error(parsedArgs.error.message);
          return tool.execute(parsedArgs.data);
        })().then(
          (value) => JSON.stringify(value),
          (err: unknown) => JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        );
        messages.push({ role: 'tool', content: resultText, tool_call_id: call.id });
      }
    }

    throw new AgentStepLimitError(`${o.name}: exceeded ${maxSteps} agent steps`);
  })();
}
