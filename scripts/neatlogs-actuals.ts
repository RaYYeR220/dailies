#!/usr/bin/env -S pnpm tsx
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../packages/core/src/index';
import { createNeatlogsMcp } from '../packages/agent/src/index';

interface KpisResponse {
  total_runs?: number;
  totalRuns?: number;
  total_cost_usd?: number;
  totalCostUsd?: number;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.neatlogsApiKey) {
    console.error('NEATLOGS_API_KEY is not set');
    process.exit(1);
    return;
  }

  const mcp = createNeatlogsMcp({ apiKey: env.neatlogsApiKey, url: `${env.neatlogsEndpoint}/mcp` });
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

  const raw = (await mcp.analytics({
    from: from.toISOString(),
    to: to.toISOString(),
    workflowName: 'dailies-reel',
    view: 'kpis',
  })) as KpisResponse;

  const runs = Number(raw.total_runs ?? raw.totalRuns ?? 0);
  const costUsdTotal = Number(raw.total_cost_usd ?? raw.totalCostUsd ?? 0);
  const costUsdPerRun = runs > 0 ? costUsdTotal / runs : 0;

  const outDir = resolve(import.meta.dirname, '..', 'business');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, 'actuals.json');
  writeFileSync(outFile, JSON.stringify({ raw, runs, costUsdTotal, costUsdPerRun }, null, 2));
  console.log(`wrote business/actuals.json (${runs} runs, $${costUsdTotal.toFixed(2)} total)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
