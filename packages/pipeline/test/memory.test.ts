import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NeatlogsMcp, TraceSummary } from '@dailies/agent';
import { NeatlogsUnavailableError } from '@dailies/agent';
import { recallRepo } from '../src/memory';

function trace(o: Partial<TraceSummary> & { traceId: string; createdAt: string }): TraceSummary {
  return {
    status: 'success',
    durationMs: 1000,
    totalTokens: 100,
    costUsd: 0.01,
    erroredSpans: 0,
    workflowName: 'dailies-reel',
    inputPreview: '',
    outputPreview: '',
    ...o,
  };
}

function makeMcp(searchTraces: NeatlogsMcp['searchTraces']): NeatlogsMcp {
  return {
    call: vi.fn(),
    searchTraces,
    traceContext: vi.fn(),
    analytics: vi.fn(),
  };
}

describe('recallRepo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns notes only for earlier runs that failed, newest first, at most five', async () => {
    const traces: TraceSummary[] = [
      trace({ traceId: 't1', createdAt: '2026-10-01T00:00:00Z', status: 'success' }),
      trace({ traceId: 't2', createdAt: '2026-10-02T00:00:00Z', status: 'error', erroredSpans: 3, outputPreview: 'oldest failure' }),
      trace({ traceId: 't3', createdAt: '2026-10-03T00:00:00Z', status: 'success', erroredSpans: 1, outputPreview: 'partial failure' }),
      trace({ traceId: 't4', createdAt: '2026-10-04T00:00:00Z', status: 'error', erroredSpans: 2, outputPreview: 'B'.repeat(150) }),
      trace({ traceId: 't5', createdAt: '2026-10-05T00:00:00Z', status: 'error', erroredSpans: 1, outputPreview: 'boom5' }),
      trace({ traceId: 't6', createdAt: '2026-10-06T00:00:00Z', status: 'error', erroredSpans: 1, outputPreview: 'boom6' }),
      trace({ traceId: 't7', createdAt: '2026-10-07T00:00:00Z', status: 'error', erroredSpans: 1, outputPreview: 'boom7' }),
    ];
    const searchTraces = vi.fn(async () => traces);
    const mcp = makeMcp(searchTraces);

    const memory = await recallRepo(mcp, 'https://github.com/foo/bar');

    expect(memory.status).toBe('used');
    expect(memory.previousRuns).toBe(7);
    expect(memory.notes).toEqual([
      '2026-10-07T00:00:00Z: error, 1 failed spans, boom7',
      '2026-10-06T00:00:00Z: error, 1 failed spans, boom6',
      '2026-10-05T00:00:00Z: error, 1 failed spans, boom5',
      `2026-10-04T00:00:00Z: error, 2 failed spans, ${'B'.repeat(120)}`,
      '2026-10-03T00:00:00Z: success, 1 failed spans, partial failure',
    ]);
    // t1 (success, no errored spans) is excluded; t2 is the 6th-newest failure and is dropped by the cap of 5.
    expect(memory.notes.some((n) => n.includes('oldest failure'))).toBe(false);

    expect(searchTraces).toHaveBeenCalledWith({
      query: 'https://github.com/foo/bar',
      dateFrom: '2026-09-27T12:00:00.000Z',
      limit: 10,
    });
  });

  it('returns skipped with the reason when the client throws, and when it is null', async () => {
    const nullResult = await recallRepo(null, 'https://github.com/foo/bar');
    expect(nullResult).toEqual({ status: 'skipped', reason: 'no neatlogs client', previousRuns: 0, notes: [] });

    const throwingMcp = makeMcp(vi.fn(async () => {
      throw new NeatlogsUnavailableError('neatlogs: unauthorized');
    }));
    const thrownResult = await recallRepo(throwingMcp, 'https://github.com/foo/bar');
    expect(thrownResult).toEqual({ status: 'skipped', reason: 'neatlogs: unauthorized', previousRuns: 0, notes: [] });
  });
});
