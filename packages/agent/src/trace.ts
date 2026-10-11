import { init, shutdown, span } from 'neatlogs';
import type { Env } from '@dailies/core';

let tracingInitialized = false;

export async function initTracing(env: Env, workflowName: string): Promise<void> {
  if (!env.neatlogsApiKey) return;
  await init({ apiKey: env.neatlogsApiKey, endpoint: env.neatlogsEndpoint, workflowName });
  tracingInitialized = true;
}

export async function shutdownTracing(): Promise<void> {
  if (!tracingInitialized) return;
  await shutdown();
  tracingInitialized = false;
}

export function isTracingInitialized(): boolean {
  return tracingInitialized;
}

export function traced<A extends unknown[], R>(
  kind: 'WORKFLOW' | 'CHAIN' | 'AGENT' | 'TOOL' | 'GUARDRAIL',
  name: string,
  fn: (...a: A) => Promise<R>,
): (...a: A) => Promise<R> {
  return span({ kind, name }, fn);
}

export async function guard(
  name: string,
  check: () => Promise<{ pass: boolean; reasons: string[] }>,
): Promise<{ pass: boolean; reasons: string[] }> {
  return traced('GUARDRAIL', name, check)();
}
