import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export interface Env {
  neatlogsApiKey: string | null; neatlogsEndpoint: string;
  gatewayKey: string | null; gatewayBaseUrl: string;
  veniceKey: string | null; geminiKeys: string[]; dataDir: string;
}
export function loadEnv(cwd = process.cwd()): Env {
  const file = resolve(cwd, '.env');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  const e = process.env;
  return {
    neatlogsApiKey: e.NEATLOGS_API_KEY || null,
    neatlogsEndpoint: e.NEATLOGS_ENDPOINT || 'https://ingest.neatlogs.com',
    gatewayKey: e.LITELLM_API_KEY || null,
    gatewayBaseUrl: e.LITELLM_BASE_URL || 'https://litellm.vision.aivar.app/v1',
    veniceKey: e.VENICE_API_KEY || null,
    geminiKeys: (e.GEMINI_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean),
    dataDir: resolve(cwd, e.DAILIES_DATA_DIR || '.dailies'),
  };
}
