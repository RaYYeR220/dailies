import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  getDiff,
  ingest,
  NoCheckpointsError,
  parseTranscript,
} from '../src/index';
import { makeRepo } from './fixture';

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout.toString().trim());
    });
  });
}

describe('ingest', () => {
  it('reads sessions from the refs layout and links commits by trailer', async () => {
    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'ab1234ef',
          sessions: [
            {
              sessionId: 's1',
              createdAt: '2026-10-10T07:00:00Z',
              lines: [
                { type: 'user', ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'run the tests' }] },
                {
                  type: 'assistant',
                  ts: '2026-10-10T07:00:05Z',
                  content: [
                    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 passed', status: 'success' } },
                    { type: 'text', text: 'All tests pass.' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const artifact = await ingest({
      repoUrl: repoDir,
      dataDir: repoDir,
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-20T00:00:00Z',
    });

    expect(artifact.sessions).toHaveLength(1);
    expect(artifact.sessions[0]!.entries).toHaveLength(4);
    expect(artifact.sessions[0]!.commits).toHaveLength(1);
  });

  it('reads the same content from the branch layout', async () => {
    const repoDir = await makeRepo({
      layout: 'branch',
      checkpoints: [
        {
          id: 'cd5678ab',
          sessions: [
            {
              sessionId: 's1',
              createdAt: '2026-10-10T07:00:00Z',
              lines: [
                { type: 'user', ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'run the tests' }] },
                {
                  type: 'assistant',
                  ts: '2026-10-10T07:00:05Z',
                  content: [
                    { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 passed', status: 'success' } },
                    { type: 'text', text: 'All tests pass.' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const artifact = await ingest({
      repoUrl: repoDir,
      dataDir: repoDir,
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-20T00:00:00Z',
    });

    expect(artifact.sessions).toHaveLength(1);
    expect(artifact.sessions[0]!.entries).toHaveLength(4);
    expect(artifact.sessions[0]!.commits).toHaveLength(1);
  });

  it('pairs a tool call with its result and marks failed results', () => {
    const { entries } = parseTranscript(
      's1',
      [
        JSON.stringify({ type: 'user', ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'run the tests' }] }),
        JSON.stringify({
          type: 'assistant',
          ts: '2026-10-10T07:00:05Z',
          content: [
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 failed', status: 'error' } },
            { type: 'text', text: 'All tests pass.' },
          ],
        }),
      ].join('\n'),
    );
    expect(entries.map((e) => e.kind)).toEqual(['user', 'tool_call', 'tool_result', 'assistant']);
    expect(entries[1]!.command).toBe('pnpm test');
    expect(entries[2]!.isError).toBe(true);
    expect(entries[3]!.id).toBe('s1:3');
  });

  it('strips ANSI codes and truncates a 2 MB tool output head-and-tail', () => {
    const stripped = 'x'.repeat(2_000_000);
    const withAnsi = `\u001b[32m${stripped}\u001b[0m`;
    const { entries } = parseTranscript(
      's1',
      JSON.stringify({
        type: 'assistant',
        ts: '2026-10-10T07:00:00Z',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: withAnsi, status: 'success' } }],
      }),
    );
    const resultEntry = entries.find((e) => e.kind === 'tool_result')!;
    expect(resultEntry.text.length).toBeLessThanOrEqual(8100);
    expect(resultEntry.text.endsWith(stripped.slice(-5000))).toBe(true);
    expect(resultEntry.text).not.toContain('\u001b');
  });

  it('redacts a key that appears in a user prompt and counts it', () => {
    const { entries, redactions } = parseTranscript(
      's1',
      JSON.stringify({
        type: 'user',
        ts: '2026-10-10T07:00:00Z',
        content: [{ id: 'u1', text: 'use OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345 to call it' }],
      }),
    );
    expect(entries[0]!.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(redactions).toBeGreaterThan(0);
  });

  it('redacts a secret that straddles the truncation boundary, leaving no fragment', () => {
    const secret = `sk-${'Q'.repeat(30)}`;
    // a space (not a word char) on each side so \b in the provider_key rule can match "sk-";
    // the secret sits across the old code's head/middle cut at character 3000.
    const filler = `${'x'.repeat(2990)} ${secret} ${'x'.repeat(10_000)}`;
    const { entries } = parseTranscript(
      's1',
      JSON.stringify({
        type: 'assistant',
        ts: '2026-10-10T07:00:00Z',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: filler, status: 'success' } }],
      }),
    );
    const resultEntry = entries.find((e) => e.kind === 'tool_result')!;
    expect(resultEntry.text).not.toMatch(/Q{6,}/);
    expect(resultEntry.text).not.toContain(secret);
  });

  it('skips malformed lines and image blocks', () => {
    const { entries } = parseTranscript(
      's1',
      [
        'not valid json {{{',
        JSON.stringify({
          type: 'user',
          ts: '2026-10-10T07:00:00Z',
          content: [{ type: 'image', data: 'base64...' }, { id: 'u1', text: 'describe the screenshot' }],
        }),
      ].join('\n'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('user');
    expect(entries[0]!.text).toBe('describe the screenshot');
  });

  it('throws NoCheckpointsError for a repo without checkpoints', async () => {
    const repoDir = await makeRepo({ layout: 'refs', checkpoints: [] });
    await expect(
      ingest({ repoUrl: repoDir, dataDir: repoDir, since: '2020-01-01T00:00:00Z', until: '2030-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(NoCheckpointsError);
  });

  it('returns no sessions when checkpoints exist but none are in the window', async () => {
    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        {
          id: 'ef9012ab',
          sessions: [
            {
              sessionId: 's1',
              createdAt: '2020-01-01T00:00:00Z',
              lines: [{ type: 'user', content: [{ id: 'u1', text: 'old session' }] }],
            },
          ],
        },
      ],
    });

    const artifact = await ingest({
      repoUrl: repoDir,
      dataDir: repoDir,
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-20T00:00:00Z',
    });

    expect(artifact.sessions).toHaveLength(0);
  });

  it('merges one session that appears in two checkpoints', async () => {
    const shortLines = [
      { type: 'user' as const, ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'start work' }] },
    ];
    const longLines = [
      { type: 'user' as const, ts: '2026-10-10T07:00:00Z', content: [{ id: 'u1', text: 'start work' }] },
      {
        type: 'assistant' as const,
        ts: '2026-10-10T07:00:05Z',
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' }, result: { output: '2 passed', status: 'success' } },
          { type: 'text', text: 'All tests pass.' },
        ],
      },
    ];

    const repoDir = await makeRepo({
      layout: 'refs',
      checkpoints: [
        { id: 'aa111111', sessions: [{ sessionId: 'shared', createdAt: '2026-10-10T07:00:00Z', lines: shortLines }] },
        { id: 'bb222222', sessions: [{ sessionId: 'shared', createdAt: '2026-10-10T07:05:00Z', lines: longLines }] },
      ],
    });

    const artifact = await ingest({
      repoUrl: repoDir,
      dataDir: repoDir,
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-20T00:00:00Z',
    });

    expect(artifact.sessions).toHaveLength(1);
    expect(artifact.sessions[0]!.entries).toHaveLength(4);
    expect(artifact.sessions[0]!.checkpointIds.sort()).toEqual(['aa111111', 'bb222222']);
    expect(artifact.sessions[0]!.commits).toHaveLength(2);
  });

  it('returns a patch for a modified file, keyed by sha:path, capped at 6000 characters', async () => {
    const repoDir = await makeRepo({ layout: 'refs', checkpoints: [] });
    await writeFile(join(repoDir, 'a.txt'), 'line one\n');
    await run(repoDir, ['add', 'a.txt']);
    await run(repoDir, ['commit', '-q', '-m', 'add a.txt']);
    await writeFile(join(repoDir, 'a.txt'), 'line one\nline two\n');
    await run(repoDir, ['add', 'a.txt']);
    await run(repoDir, ['commit', '-q', '-m', 'update a.txt']);
    const sha = await run(repoDir, ['rev-parse', 'HEAD']);

    const diffs = await getDiff(repoDir, sha);

    expect(diffs['a.txt']).toContain('+line two');
    expect(diffs['a.txt']!.length).toBeLessThanOrEqual(6000);
  });
});
