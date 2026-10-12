import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockClient, type ChatMessage, type Role } from '@dailies/agent';
import type { Env } from '@dailies/core';
import { openDb, type GateArtifact, type GroundArtifact } from '@dailies/pipeline';
import { makeRepo, type FixtureSession } from '../../ingest/test/fixture';
import { isMainModule } from '../src/index';
import { parseRunArgs, REPO_ROOT, runCommand, sanitizeForTerminal, stripUserinfo } from '../src/run';
import { verifyCommand } from '../src/verify';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dailies-cli-e2e-'));
  dirs.push(dir);
  return dir;
}

function testEnv(dataDir: string): Env {
  return { neatlogsApiKey: null, neatlogsEndpoint: 'https://ingest.neatlogs.com', gatewayKey: null, gatewayBaseUrl: '', veniceKey: null, geminiKeys: [], dataDir };
}

const FAILED_TEST_OUTPUT = '1 failed, 0 passed';
const PASSED_TEST_OUTPUT = '3 passed';

/** A session that runs `pnpm test`, then claims, in a final message, that it passed. */
function testSession(o: { sessionId: string; createdAt: string; prompt: string; outcome: 'fail' | 'pass'; claim: string }): FixtureSession {
  return {
    sessionId: o.sessionId,
    createdAt: o.createdAt,
    lines: [
      { type: 'user', content: [{ text: o.prompt }] },
      {
        type: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Bash',
            input: { command: 'pnpm test' },
            result: { output: o.outcome === 'fail' ? FAILED_TEST_OUTPUT : PASSED_TEST_OUTPUT, status: o.outcome === 'fail' ? 'error' : 'success' },
          },
        ],
      },
      { type: 'assistant', content: [{ type: 'text', text: o.claim }] },
    ],
  };
}

// Entries land at indexes 0 (user), 1 (tool_call), 2 (tool_result), 3 (assistant claim) — see transcript.ts.
const LIAR_SESSION_ID = 's1';
const HONEST_SESSION_ID = 's2';
const LIE = 'The queue test now passes.';
const TRUTH = 'The health check test now passes.';

/** One checkpoint per session, the way `packages/pipeline/test/stages/ingest.test.ts` builds its fixtures. */
async function fixtureRepo(sessions: FixtureSession[]): Promise<string> {
  const dir = await makeRepo({ layout: 'refs', checkpoints: sessions.map((s, n) => ({ id: `ab${n}234ef`, sessions: [s] })) });
  dirs.push(dir);
  return dir;
}

/** The two-session fixture: one session lies about a failed test run, the other is honest. */
function liarAndHonestSessions(): FixtureSession[] {
  return [
    testSession({ sessionId: LIAR_SESSION_ID, createdAt: '2026-10-10T07:00:00Z', prompt: 'Fix the flaky queue test.', outcome: 'fail', claim: LIE }),
    testSession({ sessionId: HONEST_SESSION_ID, createdAt: '2026-10-10T09:00:00Z', prompt: 'Add a health check endpoint.', outcome: 'pass', claim: TRUTH }),
  ];
}

type MockRequest = { role: Role; messages: ChatMessage[] };
const json = (value: unknown): ChatMessage => ({ role: 'assistant', content: JSON.stringify(value) });
const text = (messages: ChatMessage[]): string =>
  messages.filter((m) => m.role === 'system' || m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');

/** Scripted replies for every role the run exercises, tuned to `liarAndHonestSessions()`. */
function reply(req: MockRequest): ChatMessage {
  const told = text(req.messages);

  if (req.role === 'editor') {
    return json({
      beats: [
        { kind: 'fix', title: 'Fix the flaky queue test', summary: 'The agent looked at the queue test.', sessionIds: [LIAR_SESSION_ID], entryRanges: [{ sessionId: LIAR_SESSION_ID, from: 0, to: 3 }], commits: [] },
        { kind: 'feature', title: 'Add a health check endpoint', summary: 'The agent added a health check.', sessionIds: [HONEST_SESSION_ID], entryRanges: [{ sessionId: HONEST_SESSION_ID, from: 0, to: 3 }], commits: [] },
      ],
    });
  }

  if (req.role === 'extractor') {
    const sessionId = /Messages from session ([^,]+),/.exec(told)?.[1];
    if (sessionId === LIAR_SESSION_ID) return json({ claims: [{ entryId: `${LIAR_SESSION_ID}:3`, quote: LIE, kind: 'tests_pass' }] });
    if (sessionId === HONEST_SESSION_ID) return json({ claims: [{ entryId: `${HONEST_SESSION_ID}:3`, quote: TRUTH, kind: 'tests_pass' }] });
    throw new Error(`extractor: could not find a session id in the prompt: ${told}`);
  }

  if (req.role === 'judge') {
    if (told.includes('fact check for Dailies')) return json({ entailed: true });   // the ground stage's entailment check
    throw new Error(`judge: unexpected prompt (no 'implemented' claim should reach the diff judge): ${told}`);
  }

  if (req.role === 'writer') {
    if (told.includes('Rewrite that one line')) throw new Error('writer: no rewrite should be needed — the scripted lines are grounded from the start');
    return json({
      scenes: [
        { type: 'prompt', entryId: `${LIAR_SESSION_ID}:0`, lines: [{ text: 'A developer asked the agent to fix a flaky test in the queue.', evidence: [{ type: 'entry', entryId: `${LIAR_SESSION_ID}:0` }] }] },
        { type: 'terminal', steps: [{ entryId: `${HONEST_SESSION_ID}:1` }], lines: [{ text: 'In the other session the agent ran the test suite and it passed.', evidence: [{ type: 'entry', entryId: `${HONEST_SESSION_ID}:2` }] }] },
      ],
    });
  }

  throw new Error(`unexpected role: ${req.role}`);
}

function readArtifact<T>(dataDir: string, runId: string, stage: string): T {
  return JSON.parse(readFileSync(join(dataDir, 'runs', runId, `${stage}.json`), 'utf8')) as T;
}

function runIdFromVideoPath(videoPath: string): string {
  const match = /runs[/\\]([^/\\]+)[/\\]reel[/\\]reel\.mp4$/.exec(videoPath);
  if (!match) throw new Error(`could not read a run id out of ${videoPath}`);
  return match[1]!;
}

describe('dailies run (end-to-end, mock model, real renderer)', () => {
  it('flags the lie, grounds the honest claim, and renders a reel awaiting approval', async () => {
    const repoDir = await fixtureRepo(liarAndHonestSessions());
    const dataDir = scratchDataDir();
    const lines: string[] = [];

    const code = await runCommand([repoDir, '--since', '2026-10-09T00:00:00Z', '--no-review'], {
      client: createMockClient(reply),
      env: testEnv(dataDir),
      stdout: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(lines).toContain('status: needs_approval');

    const videoLine = lines.find((l) => l.startsWith('video: '));
    expect(videoLine).toBeDefined();
    const videoPath = videoLine!.slice('video: '.length);
    expect(existsSync(videoPath)).toBe(true);

    const runId = runIdFromVideoPath(videoPath);
    const ground = readArtifact<GroundArtifact>(dataDir, runId, 'ground');
    expect(ground.storyboard.scenes.filter((s) => s.type === 'flag')).toHaveLength(1);

    const render = readArtifact<{ durationSec: number }>(dataDir, runId, 'render');
    expect(render.durationSec).toBeGreaterThan(8);

    const gate = readArtifact<GateArtifact>(dataDir, runId, 'gate');
    expect(gate.checks.every((c) => c.pass)).toBe(true);
    expect(gate.checks).toHaveLength(4);
  }, 90_000);

  it('exits 2 with a clear message when the repository has no checkpoints', async () => {
    const repoDir = await fixtureRepo([]);
    const dataDir = scratchDataDir();
    const lines: string[] = [];

    const code = await runCommand([repoDir, '--since', '2026-10-09T00:00:00Z'], {
      client: createMockClient(() => {
        throw new Error('no model call should happen before a repository with no checkpoints ends the run');
      }),
      env: testEnv(dataDir),
      stdout: (line) => lines.push(line),
    });

    expect(code).toBe(2);
    expect(lines).toContain('reason: no agent sessions found in this window');
  });

  it('writes the run into dailies.db, the same database file the web app reads', async () => {
    const repoDir = await fixtureRepo([]);
    const dataDir = scratchDataDir();

    await runCommand([repoDir, '--since', '2026-10-09T00:00:00Z'], {
      client: createMockClient(() => {
        throw new Error('no model call should happen before a repository with no checkpoints ends the run');
      }),
      env: testEnv(dataDir),
      stdout: () => {},
    });

    const db = openDb(join(dataDir, 'dailies.db'));
    const row = db.prepare('SELECT status, reason FROM runs').get() as { status: string; reason: string } | undefined;
    expect(row).toEqual({ status: 'blocked', reason: 'no agent sessions found in this window' });
  });

  it('dailies verify prints the contradicted and verified claims for the same fixture', async () => {
    const repoDir = await fixtureRepo(liarAndHonestSessions());
    const dataDir = scratchDataDir();
    const lines: string[] = [];

    const code = await verifyCommand([repoDir, '--since', '2026-10-09T00:00:00Z', '--json'], {
      client: createMockClient(reply),
      env: testEnv(dataDir),
      stdout: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    const claims = JSON.parse(lines[0]!) as { sessionId: string; verdict: string }[];
    expect(claims).toHaveLength(2);
    expect(claims.find((c) => c.sessionId === LIAR_SESSION_ID)?.verdict).toBe('contradicted');
    expect(claims.find((c) => c.sessionId === HONEST_SESSION_ID)?.verdict).toBe('verified');
  });

  it('does not leave a phantom run in the shared database — it has no reel to show for one', async () => {
    const repoDir = await fixtureRepo(liarAndHonestSessions());
    const dataDir = scratchDataDir();

    await verifyCommand([repoDir, '--since', '2026-10-09T00:00:00Z', '--json'], {
      client: createMockClient(reply),
      env: testEnv(dataDir),
      stdout: () => {},
    });

    expect(existsSync(join(dataDir, 'dailies.db'))).toBe(false);
  });
});

describe('sanitizeForTerminal', () => {
  it('escapes control characters so untrusted event text cannot inject terminal escape sequences', () => {
    const malicious = 'ok\u001b[2J\u001b[1;1Hpwned\r\n';

    expect(sanitizeForTerminal(malicious)).toBe('ok\\u{1b}[2J\\u{1b}[1;1Hpwned\\u{d}\\u{a}');
  });

  it('escapes a Unicode bidi override, not just the C0/C1 range', () => {
    const spoofed = `safe\u202Eevil`; // U+202E right-to-left override

    expect(sanitizeForTerminal(spoofed)).toBe('safe\\u{202e}evil');
  });

  it('escapes a literal backslash so the output stays unambiguous', () => {
    expect(sanitizeForTerminal('C:\\repo\u001b')).toBe('C:\\\\repo\\u{1b}');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeForTerminal('3 sessions, 2 file diffs')).toBe('3 sessions, 2 file diffs');
  });
});

describe('REPO_ROOT', () => {
  it('resolves to the Dailies monorepo root, not wherever the CLI happens to be invoked from — needed for the entire-dailies plugin flow, which runs from inside the target repository', () => {
    expect(existsSync(join(REPO_ROOT, 'pnpm-workspace.yaml'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, 'packages', 'cli', 'package.json'))).toBe(true);
  });
});

describe('parseRunArgs', () => {
  it('takes --resume with a run id and no repository', () => {
    expect(parseRunArgs(['--resume', 'run_3a06918cb956', '--out', 'x'])).toMatchObject({ resume: 'run_3a06918cb956', out: 'x' });
    expect(() => parseRunArgs(['--resume', '../../etc/passwd'])).toThrow(/--resume/);
    expect(() => parseRunArgs(['--resume'])).toThrow();
  });

  it('parses --max-sessions as a positive integer', () => {
    expect(parseRunArgs(['repo', '--max-sessions', '5']).maxSessions).toBe(5);
  });

  it('rejects a non-numeric --max-sessions instead of silently becoming NaN', () => {
    expect(() => parseRunArgs(['repo', '--max-sessions', 'abc'])).toThrow(/--max-sessions/);
  });

  it('rejects a zero or negative --max-sessions instead of silently dropping every session', () => {
    expect(() => parseRunArgs(['repo', '--max-sessions', '0'])).toThrow(/--max-sessions/);
    expect(() => parseRunArgs(['repo', '--max-sessions', '-3'])).toThrow(/--max-sessions/);
  });
});

describe('isMainModule', () => {
  it('recognizes the same file reached through a symlink, not just an identical path string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dailies-cli-mainmod-'));
    dirs.push(dir);
    const real = join(dir, 'index.ts');
    writeFileSync(real, 'export {};');
    const linkDir = join(dir, 'link');
    mkdirSync(linkDir);
    const link = join(linkDir, 'index.ts');
    symlinkSync(real, link);

    expect(isMainModule(pathToFileURL(real).toString(), link)).toBe(true);
  });

  it('recognizes the same file when its path contains a space the URL would percent-encode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dailies cli mainmod '));
    dirs.push(dir);
    const file = join(dir, 'index.ts');
    writeFileSync(file, 'export {};');

    expect(isMainModule(pathToFileURL(file).toString(), file)).toBe(true);
  });

  it('rejects two unrelated files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dailies-cli-mainmod-'));
    dirs.push(dir);
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.ts');
    writeFileSync(a, 'export {};');
    writeFileSync(b, 'export {};');

    expect(isMainModule(pathToFileURL(a).toString(), b)).toBe(false);
  });

  it('rejects when argv1 is absent, as it is when node evaluates a module that only imports this one', () => {
    expect(isMainModule('file:///anything', undefined)).toBe(false);
  });
});

describe('stripUserinfo', () => {
  it('removes a credential pasted into a repository URL before it reaches tracing input', () => {
    expect(stripUserinfo('https://x-access-token:ghp_secret@github.com/acme/repo.git')).toBe('https://github.com/acme/repo.git');
  });

  it('leaves a local path or an SCP-style URL unchanged, since neither carries an embedded secret', () => {
    expect(stripUserinfo('/tmp/some-repo')).toBe('/tmp/some-repo');
    expect(stripUserinfo('git@github.com:acme/repo.git')).toBe('git@github.com:acme/repo.git');
  });

  it('still strips the credential when the rest of the URL is malformed enough that URL() rejects it', () => {
    // Neither of these parses as a URL (an invalid port) but both carry a real credential.
    expect(stripUserinfo('https://tok@github.com:acme/repo.git')).toBe('https://github.com:acme/repo.git');
    expect(stripUserinfo('https://u:p@host:99999/x')).toBe('https://host:99999/x');
  });
});
