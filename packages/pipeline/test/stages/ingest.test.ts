import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRepo, type FixtureSession } from '../../../ingest/test/fixture';
import { ingestStage } from '../../src/stages/ingest';
import { cleanup, harness } from './fixture';

const repos: string[] = [];
afterEach(() => {
  cleanup();
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NO_SESSIONS = { status: 'blocked', reason: 'no agent sessions found in this window' };

/** One recorded session that starts at `at`; the harness run covers 10 October 2026. */
const recorded = (sessionId: string, at: string): FixtureSession => ({
  sessionId,
  createdAt: at,
  lines: [
    { type: 'user', ts: at, content: [{ text: 'run the tests' }] },
    { type: 'assistant', ts: at, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 passed', status: 'success' } }, { type: 'text', text: 'All tests pass.' }] },
  ],
});

async function repo(sessions: FixtureSession[]): Promise<string> {
  const dir = await makeRepo({ layout: 'refs', checkpoints: sessions.map((s, n) => ({ id: `ab${n}234ef`, sessions: [s] })) });
  repos.push(dir);
  return dir;
}

describe('ingest stage', () => {
  it('ingest ends the run when the repository has no checkpoints', async () => {
    const h = harness({ repoUrl: await repo([]) });

    const result = await ingestStage().run(h.ctx());

    expect(result.final).toEqual(NO_SESSIONS);
    expect(result.artifact.sessions).toEqual([]);
  });

  it('ingest ends the run when no session falls inside the window', async () => {
    const h = harness({ repoUrl: await repo([recorded('old', '2026-09-01T07:00:00Z')]) });

    const result = await ingestStage().run(h.ctx());

    expect(result.final).toEqual(NO_SESSIONS);
    expect(result.artifact.sessions).toEqual([]);
  });

  it('ingest returns the sessions of the window and their diffs, and lets the run go on', async () => {
    const dir = await repo([recorded('old', '2026-09-01T07:00:00Z'), recorded('fresh', '2026-10-10T07:00:00Z')]);
    const h = harness({ repoUrl: dir });

    const result = await ingestStage().run(h.ctx());

    expect(result.final).toBeUndefined();
    expect(result.artifact.sessions.map((s) => s.id)).toEqual(['fresh']);
    expect(result.artifact.sessions[0]!.entries.map((e) => e.kind)).toEqual(['user', 'tool_call', 'tool_result', 'assistant']);
    expect(result.artifact.repo.dir).toBe(dir);
    expect(Object.keys(result.artifact.diffs)).toHaveLength(1);
    expect(h.events.join('\n')).toMatch(/1 session/);
  });

  it('ingest lets any other failure through, for the runner to retry', async () => {
    const h = harness({ repoUrl: 'https://127.0.0.1:1/acme/unreachable.git' });   // nothing listens there: the clone fails at once
    const stage = ingestStage();

    expect(stage.maxAttempts).toBeGreaterThanOrEqual(2);
    await expect(stage.run(h.ctx())).rejects.toThrow();
  });

  it('ingest keeps credentials pasted into the repository URL out of the error it rethrows', async () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const h = harness({ repoUrl: `https://x-access-token:${token}@127.0.0.1:1/acme/unreachable.git` });

    const error = await ingestStage().run(h.ctx()).then(() => null, (err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain('127.0.0.1:1/acme/unreachable.git');
    expect(error!.message).not.toContain(token);
    expect(error!.message).not.toContain('x-access-token');
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(token);
  });

  it('ingest strips the whole userinfo when the password itself holds an @', async () => {
    const h = harness({ repoUrl: 'https://deploy:p@ss-w0rd-long@127.0.0.1:1/acme/unreachable.git' });

    const error = await ingestStage().run(h.ctx()).then(() => null, (err: Error) => err);

    expect(error!.message).toContain('https://127.0.0.1:1/acme/unreachable.git');
    expect(error!.message).not.toMatch(/p@ss|ss-w0rd-long|deploy/);
  });

  it('ingest keeps credentials out of the artifact as well', async () => {
    const h = harness({ repoUrl: 'file://deploy:hunter2hunter2@fileserver/acme/nothing-here' });

    const result = await ingestStage().run(h.ctx());

    expect(result.final).toEqual(NO_SESSIONS);
    expect(result.artifact.repo.url).toBe('file://fileserver/acme/nothing-here');
  });

  it('ingest passes the deps maxSessions cap through to ingest()', async () => {
    const dir = await repo([
      recorded('one', '2026-10-10T07:00:00Z'),
      recorded('two', '2026-10-10T08:00:00Z'),
      recorded('three', '2026-10-10T09:00:00Z'),
    ]);
    const h = harness({ repoUrl: dir, maxSessions: 1 });

    const result = await ingestStage(h.deps).run(h.ctx());

    expect(result.artifact.sessions.map((s) => s.id)).toEqual(['three']);
  });

  it('ingest forwards onProgress messages from ingest() into ctx.log', async () => {
    const dir = await repo([recorded('fresh', '2026-10-10T07:00:00Z')]);
    const h = harness({ repoUrl: dir });

    await ingestStage(h.deps).run(h.ctx());

    expect(h.events).toContain('cloning');
    expect(h.events.some((e) => /checkpoints/.test(e))).toBe(true);
    expect(h.events.some((e) => /sessions in window/.test(e))).toBe(true);
  });
});
