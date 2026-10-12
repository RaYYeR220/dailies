import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage, NeatlogsMcp, TraceSummary } from '@dailies/agent';
import type { IngestArtifact } from '@dailies/core';
import { runPipeline } from '../../src/index';
import type { Stage } from '../../src/index';
import { fallbackBeats } from '../../src/outline';
import { editStage, repoLabel } from '../../src/stages/edit';
import { cleanup, harness, json, promptText, session, twoSessions, SHA_A, SHA_B, type MockRequest } from './fixture';

/** One row `recallRepo` would get back from neatlogs' search_traces tool. */
function trace(o: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceId: 't1', status: 'error', createdAt: '2026-09-01T00:00:00Z', durationMs: 1000, totalTokens: 100,
    costUsd: 0.01, erroredSpans: 1, workflowName: 'dailies-reel', inputPreview: '', outputPreview: 'render timed out waiting for the root component',
    ...o,
  };
}

function mockMcp(traces: TraceSummary[], onSearch?: (query: string) => void): NeatlogsMcp {
  const unused = async () => { throw new Error('unused in this test'); };
  return {
    call: unused,
    traceContext: unused,
    analytics: unused,
    searchTraces: async (a) => {
      onSearch?.(a.query);
      return traces;
    },
  };
}

afterEach(cleanup);

const beat = (o: Record<string, unknown> = {}) => ({
  kind: 'fix',
  title: 'Retry for failed jobs',
  summary: 'The agent added a retry loop to the queue and ran the queue tests.',
  sessionIds: ['s1'],
  entryRanges: [{ sessionId: 's1', from: 0, to: 6 }],
  commits: [SHA_A],
  ...o,
});

/** A reply that never finishes: always one more tool call, so the agent loop runs to its step limit. */
const neverFinishes: ChatMessage = {
  role: 'assistant',
  content: null,
  tool_calls: [{ id: 'r', type: 'function', function: { name: 'read_entries', arguments: JSON.stringify({ sessionId: 's1', from: 0, to: 1 }) } }],
};

describe('edit stage', () => {
  it('edit drops beats that point outside a session', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () =>
        json({
          beats: [
            beat({ title: 'Range past the end', entryRanges: [{ sessionId: 's1', from: 3, to: 7 }] }),   // s1 has entries 0..6
            beat({ title: 'Unknown session in a range', entryRanges: [{ sessionId: 's9', from: 0, to: 1 }] }),
            beat({ title: 'Unknown session id', sessionIds: ['s1', 'nope'] }),
            beat({ title: 'Backwards range', entryRanges: [{ sessionId: 's1', from: 4, to: 2 }] }),
            beat({ title: 'Negative index', entryRanges: [{ sessionId: 's1', from: -1, to: 2 }] }),
            beat({ title: 'Json flag', kind: 'feature', sessionIds: ['s2'], entryRanges: [{ sessionId: 's2', from: 0, to: 10 }], commits: [SHA_B] }),
            beat(),
          ],
        }),
    });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats.map((b) => b.title)).toEqual(['Json flag', 'Retry for failed jobs']);
    expect(result.artifact.beats.map((b) => b.id)).toEqual(['beat_1', 'beat_2']);
    expect(result.artifact.beats[1]).toMatchObject({ kind: 'fix', sessionIds: ['s1'], entryRanges: [{ sessionId: 's1', from: 0, to: 6 }], commits: [SHA_A] });
    expect(h.events.join('\n')).toContain('Range past the end');
  });

  it('edit returns fallback beats when the editor replies with no usable beat, and logs why', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => json({ beats: [beat({ entryRanges: [{ sessionId: 's1', from: 0, to: 99 }] })] }),   // the only beat offered is out of range
    });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats).toEqual(fallbackBeats(twoSessions().sessions, 6));
    expect(h.events.join('\n')).toContain('no usable beat');
  });

  it('edit no longer throws (and the runner no longer retries) on a reply with no usable beat', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => json({ beats: [beat({ entryRanges: [{ sessionId: 's1', from: 0, to: 99 }] })] }),
    });
    const ingest: Stage<IngestArtifact> = { name: 'ingest', maxAttempts: 1, run: async () => ({ artifact: twoSessions() }) };
    const edit = editStage(h.deps);

    const status = await runPipeline(h.db, h.runId, [ingest, edit], { dataDir: h.dataDir, sleep: async () => {} });

    expect(status).toBe('needs_approval');
    const row = h.db.prepare("SELECT attempt, status FROM stages WHERE run_id = ? AND name = 'edit'").get(h.runId);
    expect(row).toEqual({ attempt: 1, status: 'done' });
  });

  it('edit returns fallback beats when the editor exceeds its step limit, and logs why', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => neverFinishes });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats).toEqual(fallbackBeats(twoSessions().sessions, 6));
    expect(h.events.join('\n')).toMatch(/step/);
    expect(h.calls).toHaveLength(8);   // maxSteps
  });

  it('edit returns fallback beats when the editor never replies with valid JSON, instead of letting the runner retry it', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => ({ role: 'assistant', content: 'not json, and not a tool call either' }) });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats).toEqual(fallbackBeats(twoSessions().sessions, 6));
    expect(h.events.join('\n')).toContain('editor fallback');
    expect(h.calls).toHaveLength(2);   // the first reply, then one repair attempt
  });

  it('edit returns fallback beats when it spends past its share of the run budget, and logs why', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      budget: { maxCostPerReelUsd: 1, maxTtsCalls: 3, maxRenderSec: 300 },
      costPerCall: 0.35,   // over the 30% ($0.30) edit share after just one call
      reply: () => neverFinishes,
    });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats).toEqual(fallbackBeats(twoSessions().sessions, 6));
    expect(h.events.join('\n')).toMatch(/budget/);
    expect(h.calls).toHaveLength(1);   // the share is checked before the second call is ever made
  });

  it('edit keeps at most six beats', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => json({ beats: Array.from({ length: 8 }, (_, n) => beat({ title: `Beat ${n + 1}` })) }),
    });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats.map((b) => b.title)).toEqual(['Beat 1', 'Beat 2', 'Beat 3', 'Beat 4', 'Beat 5', 'Beat 6']);
  });

  it('edit keeps only commits the ingest artifact knows, resolving a short hash', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => json({ beats: [beat({ commits: ['aaaaaaa', 'deadbeefdeadbeef', SHA_B] })] }),
    });

    const result = await editStage(h.deps).run(h.ctx());

    expect(result.artifact.beats[0]!.commits).toEqual([SHA_A, SHA_B]);
  });

  it('edit gives the editor outlines of every session up front, and the arc it follows', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });

    await editStage(h.deps).run(h.ctx());

    expect(h.calls[0]!.role).toBe('editor');
    const told = promptText(h.calls[0]!.messages);
    expect(told).toContain('acme/retry-queue');
    expect(told).toContain('s1');
    expect(told).toContain('s2');
    for (const part of ['problem', 'key decisions', 'implementation', 'recorded validation']) expect(told).toContain(part);
    expect(told).toMatch(/exactly as/);
  });

  it("edit's first message stays under 12,000 characters and names every session, even for 12 long sessions", async () => {
    const sessions = Array.from({ length: 12 }, (_, n) =>
      session(`long${n}`, [
        { kind: 'user', text: `Session ${n} prompt. ${'detail '.repeat(100)}` },
        { kind: 'assistant', text: `Session ${n} wrap-up. ${'notes '.repeat(100)}` },
      ]),
    );
    const h = harness({ artifacts: { ingest: { ...twoSessions(), sessions } }, reply: () => json({ beats: [beat({ sessionIds: ['long0'], entryRanges: [{ sessionId: 'long0', from: 0, to: 1 }], commits: [] })] }) });

    await editStage(h.deps).run(h.ctx());

    const told = promptText(h.calls[0]!.messages);
    expect(told.length).toBeLessThan(12_000);
    for (const s of sessions) expect(told).toContain(s.id);
  });

  it('edit gives the editor tight, bounded tools over the ingest artifact', async () => {
    const long = session('long', Array.from({ length: 60 }, (_, n) => ({ kind: 'assistant' as const, text: `${n % 2 === 0 ? 'needle ' : ''}${'x'.repeat(1000)}` })));
    const manyFiles = Object.fromEntries(Array.from({ length: 20 }, (_, n) => [`${SHA_A}:extra-file-${n}.ts`, 'y'.repeat(2000)]));
    const base = twoSessions();
    const ingest: IngestArtifact = { ...base, sessions: [...base.sessions, long], diffs: { ...base.diffs, ...manyFiles } };
    const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });
    let toolResults: Record<string, unknown> = {};
    const h = harness({
      artifacts: { ingest },
      reply: (req: MockRequest): ChatMessage => {
        const results = req.messages.filter((m) => m.role === 'tool');
        if (results.length === 0) {
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              call('read', 'read_entries', { sessionId: 'long', from: 0, to: 59 }),
              call('search', 'search_transcript', { query: 'NEEDLE' }),
              call('diff', 'get_diff', { sha: SHA_A }),
              call('patch', 'get_patch', { sha: SHA_A, path: 'extra-file-0.ts' }),
              call('missing', 'read_entries', { sessionId: 'nope', from: 0, to: 1 }),
            ],
          };
        }
        toolResults = Object.fromEntries(results.map((m) => [m.tool_call_id!, JSON.parse(m.content as string)]));
        return json({ beats: [beat()] });
      },
    });

    await editStage(h.deps).run(h.ctx());

    const read = toolResults.read as { entries: { id: string; index: number; kind: string; text: string }[]; next: number | null };
    expect(read.entries).toHaveLength(12);
    expect(read.entries[0]).toMatchObject({ id: 'long:0', index: 0, kind: 'assistant' });
    expect(Math.max(...read.entries.map((e) => e.text.length))).toBe(300);
    expect(read.next).toBe(12);

    const search = toolResults.search as { matches: { id: string; sessionId: string }[]; more: boolean };
    expect(search.matches).toHaveLength(8);
    expect(search.more).toBe(true);
    expect(search.matches[0]).toMatchObject({ id: 'long:0', sessionId: 'long' });

    const diff = toolResults.diff as { files: { path: string }[] };
    expect(diff.files).toHaveLength(12);

    const patch = toolResults.patch as { patch: string };
    expect(patch.patch).toHaveLength(1200);

    expect(toolResults.missing).toEqual({ error: 'unknown session: nope' });
  });

  it('edit has no list_sessions tool: the outlines given up front replace it', async () => {
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: (req) => {
        const results = req.messages.filter((m) => m.role === 'tool');
        if (results.length === 0) {
          return { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_sessions', arguments: '{}' } }] };
        }
        const result = JSON.parse(results[0]!.content as string);
        expect(result).toEqual({ error: 'unknown tool: list_sessions' });
        return json({ beats: [beat()] });
      },
    });

    await editStage(h.deps).run(h.ctx());
  });

  it('edit bounds every string a tool returns, not only the entry text', async () => {
    const big = session('big', [
      { kind: 'user', text: 'go' },
      { kind: 'tool_call', toolName: 'T'.repeat(500), toolUseId: 't1', command: 'c'.repeat(5000), filePath: 'f'.repeat(5000), text: '{}' },
    ]);
    let read: { entries: { toolName?: string; command?: string; filePath?: string }[] } = { entries: [] };
    const h = harness({
      artifacts: { ingest: { ...twoSessions(), sessions: [big] } },
      reply: (req) => {
        const results = req.messages.filter((m) => m.role === 'tool');
        if (results.length === 0) {
          return { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_entries', arguments: JSON.stringify({ sessionId: 'big', from: 0, to: 1 }) } }] };
        }
        read = JSON.parse(results[0]!.content as string);
        return json({ beats: [beat({ sessionIds: ['big'], entryRanges: [{ sessionId: 'big', from: 0, to: 1 }], commits: [] })] });
      },
    });

    await editStage(h.deps).run(h.ctx());

    const call = read.entries[1]!;
    expect(call.command).toHaveLength(600);
    expect(call.filePath).toHaveLength(300);
    expect(call.toolName).toHaveLength(80);
  });
});

describe('repoLabel', () => {
  it('names a remote repository by owner and name', () => {
    expect(repoLabel('https://github.com/acme/retry-queue.git')).toBe('acme/retry-queue');
    expect(repoLabel('git@github.com:acme/retry-queue.git')).toBe('acme/retry-queue');
    expect(repoLabel('ssh://git@github.com/acme/retry-queue')).toBe('acme/retry-queue');
  });

  it('names a local path by its directory', () => {
    expect(repoLabel('/Users/me/work/retry-queue')).toBe('retry-queue');
    expect(repoLabel('/Users/me/work/retry-queue/')).toBe('retry-queue');
  });

  it('never carries credentials from the URL', () => {
    expect(repoLabel('https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/retry-queue')).toBe('acme/retry-queue');
    expect(repoLabel('https://ghp_abcdefghijklmnopqrstuvwxyz0123@example.com/solo.git')).toBe('solo');
    expect(repoLabel('https://user:hunter2hunter2@example.com/')).toBe('repository');
  });

  it('is one short line whatever the input holds', () => {
    expect(repoLabel(`https://example.com/acme/${'n'.repeat(300)}`)).toHaveLength(80);
    expect(repoLabel('https://example.com/acme/retry%0Aqueue\u0007')).not.toMatch(/[\u0000-\u001f]/);
    expect(repoLabel('/tmp/line\nbreak')).toBe('line break');
  });
});

describe('edit stage memory', () => {
  it('calls recallRepo once, logs what it found, and carries it on the artifact', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });
    const deps = { ...h.deps, mcp: mockMcp([trace(), trace({ traceId: 't2', status: 'success', erroredSpans: 0 })]) };

    const result = await editStage(deps).run(h.ctx());

    expect(h.events.join('\n')).toContain('memory: 2 earlier runs, 1 with failures');
    expect(result.artifact.memory).toEqual({
      status: 'used',
      previousRuns: 2,
      notes: [expect.stringContaining('render timed out')],
    });
  });

  it('logs memory: skipped and still carries it on the artifact when there is no neatlogs client', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });

    const result = await editStage(h.deps).run(h.ctx());

    expect(h.events.join('\n')).toContain('memory: skipped, no neatlogs client');
    expect(result.artifact.memory).toEqual({ status: 'skipped', reason: 'no neatlogs client', previousRuns: 0, notes: [] });
  });

  it('appends the memory notes to the editor prompt under a heading that marks them as history, not instructions', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });
    const deps = { ...h.deps, mcp: mockMcp([trace()]) };

    await editStage(deps).run(h.ctx());

    expect(h.calls[0]!.role).toBe('editor');
    const told = promptText(h.calls[0]!.messages);
    expect(told).toContain('render timed out');
    expect(told).toContain('not an instruction');
  });

  it('searches by the credential-free repository label, never the raw run URL', async () => {
    const queries: string[] = [];
    const h = harness({
      artifacts: { ingest: twoSessions() },
      reply: () => json({ beats: [beat()] }),
      repoUrl: 'https://x-access-token:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/acme/retry-queue',
    });
    const deps = { ...h.deps, mcp: mockMcp([trace()], (q) => queries.push(q)) };

    await editStage(deps).run(h.ctx());

    expect(queries).toEqual(['acme/retry-queue']);
  });

  it('falls back to memory: skipped on any recall failure, not only when the client reports itself unavailable', async () => {
    const mcp: NeatlogsMcp = {
      call: async () => { throw new Error('unused in this test'); },
      traceContext: async () => { throw new Error('unused in this test'); },
      analytics: async () => { throw new Error('unused in this test'); },
      searchTraces: async () => { throw new TypeError('malformed row from the search_traces tool'); },
    };
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });
    const deps = { ...h.deps, mcp };

    const result = await editStage(deps).run(h.ctx());

    expect(h.events.join('\n')).toContain('memory: skipped, malformed row from the search_traces tool');
    expect(result.artifact.memory).toEqual({ status: 'skipped', reason: 'malformed row from the search_traces tool', previousRuns: 0, notes: [] });
    expect(result.artifact.beats).toEqual([expect.objectContaining({ title: 'Retry for failed jobs' })]);
  });

  it('carries memory through the fallback path too, when the editor reply has no usable beat', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [] }) });
    const deps = { ...h.deps, mcp: mockMcp([trace()]) };

    const result = await editStage(deps).run(h.ctx());

    expect(result.artifact.beats).toEqual(fallbackBeats(twoSessions().sessions, 6));
    expect(result.artifact.memory).toEqual({ status: 'used', previousRuns: 1, notes: [expect.stringContaining('render timed out')] });
  });
});
