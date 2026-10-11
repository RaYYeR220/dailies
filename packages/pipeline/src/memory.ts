import type { NeatlogsMcp } from '@dailies/agent';
import { NeatlogsUnavailableError } from '@dailies/agent';

export interface RunMemory {
  status: 'used' | 'skipped';
  reason?: string;
  previousRuns: number;
  notes: string[];
}

const LOOKBACK_DAYS = 14;
const MAX_NOTES = 5;
const NOTE_PREVIEW_CHARS = 120;

export async function recallRepo(mcp: NeatlogsMcp | null, repoUrl: string): Promise<RunMemory> {
  if (!mcp) return { status: 'skipped', reason: 'no neatlogs client', previousRuns: 0, notes: [] };

  const dateFrom = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const traces = await mcp.searchTraces({ query: repoUrl, dateFrom, limit: 10 });
    const notes = traces
      .filter((t) => t.erroredSpans > 0 || t.status !== 'success')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_NOTES)
      .map((t) => `${t.createdAt}: ${t.status}, ${t.erroredSpans} failed spans, ${t.outputPreview.slice(0, NOTE_PREVIEW_CHARS)}`);
    return { status: 'used', previousRuns: traces.length, notes };
  } catch (err) {
    if (err instanceof NeatlogsUnavailableError) {
      return { status: 'skipped', reason: err.message, previousRuns: 0, notes: [] };
    }
    throw err;
  }
}
