import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@dailies/agent';
import type { IngestArtifact } from '@dailies/core';
import { runPipeline } from '../../src/index';
import type { Stage } from '../../src/index';
import { editStage } from '../../src/stages/edit';
import { cleanup, harness, json, promptText, session, twoSessions, SHA_A, SHA_B, QUEUE_PATCH, type MockRequest } from './fixture';

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

  it('edit fails on zero beats, so the runner retries it', async () => {
    let attempts = 0;
    const h = harness({
      reply: () => {
        attempts += 1;
        return attempts === 1 ? json({ beats: [beat({ entryRanges: [{ sessionId: 's1', from: 0, to: 99 }] })] }) : json({ beats: [beat()] });
      },
    });
    const ingest: Stage<IngestArtifact> = { name: 'ingest', maxAttempts: 1, run: async () => ({ artifact: twoSessions() }) };
    const edit = editStage(h.deps);
    expect(edit.maxAttempts).toBeGreaterThanOrEqual(2);

    await expect(edit.run({ ...h.ctx(), read: <T>() => twoSessions() as T })).rejects.toThrow(/no usable beat/);

    attempts = 0;
    const status = await runPipeline(h.db, h.runId, [ingest, edit], { dataDir: h.dataDir, sleep: async () => {} });
    expect(status).toBe('needs_approval');
    expect(attempts).toBe(2);
    const row = h.db.prepare("SELECT attempt, status FROM stages WHERE run_id = ? AND name = 'edit'").get(h.runId);
    expect(row).toEqual({ attempt: 2, status: 'done' });
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

  it('edit tells the editor what the reel is for and the arc it follows', async () => {
    const h = harness({ artifacts: { ingest: twoSessions() }, reply: () => json({ beats: [beat()] }) });

    await editStage(h.deps).run(h.ctx());

    expect(h.calls[0]!.role).toBe('editor');
    const told = promptText(h.calls[0]!.messages);
    expect(told).toContain('acme/retry-queue');
    for (const part of ['problem', 'key decisions', 'implementation', 'recorded validation']) expect(told).toContain(part);
    expect(told).toMatch(/exactly as/);
  });

  it('edit gives the editor bounded tools over the ingest artifact', async () => {
    const long = session(
      'long',
      Array.from({ length: 60 }, (_, n) => ({ kind: 'assistant' as const, text: `${n % 2 === 0 ? 'needle ' : ''}${'x'.repeat(1000)}` })),
    );
    const base = twoSessions();
    const ingest: IngestArtifact = { ...base, sessions: [...base.sessions, long] };
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
              call('list', 'list_sessions', {}),
              call('read', 'read_entries', { sessionId: 'long', from: 0, to: 59 }),
              call('search', 'search_transcript', { query: 'NEEDLE' }),
              call('diff', 'get_diff', { sha: SHA_A }),
              call('patch', 'get_patch', { sha: SHA_A, path: 'src/queue.ts' }),
              call('missing', 'read_entries', { sessionId: 'nope', from: 0, to: 1 }),
            ],
          };
        }
        toolResults = Object.fromEntries(results.map((m) => [m.tool_call_id!, JSON.parse(m.content as string)]));
        return json({ beats: [beat()] });
      },
    });

    await editStage(h.deps).run(h.ctx());

    const sessions = toolResults.list as { id: string; firstPrompt: string; entryCount: number; commits: string[]; agent: string; model: string; start: string; end: string }[];
    expect(sessions.map((s) => s.id)).toEqual(['s1', 's2', 'long']);
    expect(sessions[0]).toEqual({
      id: 's1',
      agent: 'claude-code',
      model: 'claude-sonnet-4.6',
      start: '2026-10-10T07:00:00Z',
      end: '2026-10-10T07:30:00Z',
      entryCount: 7,
      commits: [SHA_A],
      firstPrompt: 'The queue drops jobs when the worker restarts. Add a retry with backoff.',
    });

    const read = toolResults.read as { entries: { id: string; index: number; kind: string; text: string }[] };
    expect(read.entries).toHaveLength(40);
    expect(read.entries[0]).toMatchObject({ id: 'long:0', index: 0, kind: 'assistant' });
    expect(Math.max(...read.entries.map((e) => e.text.length))).toBe(600);

    const search = toolResults.search as { matches: { id: string; sessionId: string }[] };
    expect(search.matches).toHaveLength(20);
    expect(search.matches[0]).toMatchObject({ id: 'long:0', sessionId: 'long' });

    expect(toolResults.diff).toEqual({ files: [{ path: 'src/queue.ts', added: 5, removed: 1 }] });
    expect(toolResults.patch).toEqual({ patch: QUEUE_PATCH });
    expect(toolResults.missing).toEqual({ error: 'unknown session: nope' });
  });

  it('edit cuts the first prompt of a session to 200 characters', async () => {
    const wordy = session('wordy', [{ kind: 'user', text: 'p'.repeat(500) }, { kind: 'assistant', text: 'ok' }]);
    let firstPrompt = '';
    const h = harness({
      artifacts: { ingest: { ...twoSessions(), sessions: [wordy] } },
      reply: (req) => {
        const result = req.messages.find((m) => m.role === 'tool');
        if (!result) return { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_sessions', arguments: '{}' } }] };
        firstPrompt = (JSON.parse(result.content as string) as { firstPrompt: string }[])[0]!.firstPrompt;
        return json({ beats: [beat({ sessionIds: ['wordy'], entryRanges: [{ sessionId: 'wordy', from: 0, to: 1 }], commits: [] })] });
      },
    });

    await editStage(h.deps).run(h.ctx());

    expect(firstPrompt).toHaveLength(200);
  });
});
