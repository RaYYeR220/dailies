import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IngestArtifact } from '@dailies/core';
import { ingestStage } from '../../src/stages/ingest';
import { cleanup, harness, twoSessions } from './fixture';

// Only what the stage does with ingest's result is under test here, with messages git would not produce on demand.
const scripted: { message: string; artifact: IngestArtifact | null } = { message: '', artifact: null };
vi.mock('@dailies/ingest', () => ({
  NoCheckpointsError: class NoCheckpointsError extends Error {},
  ingest: async () => {
    if (scripted.artifact) return scripted.artifact;
    throw new Error(scripted.message);
  },
}));

afterEach(() => {
  cleanup();
  scripted.artifact = null;
});

const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const rethrown = async (repoUrl: string, message: string) => {
  scripted.message = message;
  const h = harness({ repoUrl });
  return ingestStage().run(h.ctx()).then(() => { throw new Error('the stage did not fail'); }, (err: Error) => err.message);
};

describe('ingest stage, what it passes on', () => {
  it('ingest removes the URL credentials from an error even where they stand outside a URL', async () => {
    const message = await rethrown(`https://deploy-bot:${TOKEN}@example.com/acme/repo.git`, `fatal: Authentication failed for user deploy-bot with password ${TOKEN}`);

    expect(message).toBe('fatal: Authentication failed for user [REDACTED] with password [REDACTED]');
  });

  it('ingest removes credentials that the URL carries percent-encoded', async () => {
    const message = await rethrown('https://deploy-bot:s3cr%40t%2Fvalue@example.com/acme/repo.git', 'fatal: bad password s3cr@t/value (sent as s3cr%40t%2Fvalue)');

    expect(message).toBe('fatal: bad password [REDACTED] (sent as [REDACTED])');
  });

  it('ingest reads the userinfo the way git does, up to the last @ before the path, whatever it holds', async () => {
    const url = 'https://deploy-bot:pa?ss#word-long@example.com/acme/repo.git';

    expect(await rethrown(url, `Command failed: git clone ${url} /data/repos/acme__repo`)).toBe('Command failed: git clone https://example.com/acme/repo.git /data/repos/acme__repo');
    expect(await rethrown(url, 'remote: invalid credentials pa?ss#word-long for deploy-bot')).toBe('remote: invalid credentials [REDACTED] for [REDACTED]');
    // a URL other than the run's own, in the same message
    expect(await rethrown(url, 'redirected to https://other:t?ken#value@mirror.example.com/acme/repo.git')).toBe('redirected to https://mirror.example.com/acme/repo.git');
  });

  it('ingest bounds a huge error message and drops a secret that sits on the cut', async () => {
    const head = `${'h'.repeat(990)} ${TOKEN} `;   // the token straddles character 1000
    const message = await rethrown('https://example.com/acme/repo.git', `${head}${'m'.repeat(2_000_000)} tail says fatal: unable to access the remote`);

    expect(message.length).toBeLessThanOrEqual(2010);
    expect(message.startsWith('h'.repeat(990))).toBe(true);
    expect(message.endsWith('fatal: unable to access the remote')).toBe(true);
    expect(message).not.toContain('ghp_');
    expect(message).not.toContain('a1B2c3D4e5');
  });

  it('ingest keeps nothing from beyond the cut, however much the redactions before it shrink the text', async () => {
    const long = (n: number) => `ghp_${String(n).repeat(3000)}`;   // three secrets of 3 KB each, then a fourth cut short
    const message = await rethrown('https://example.com/acme/repo.git', `${long(1)} ${long(2)} ${long(3)} ${'f'.repeat(160)} ghp_a1B2c3D4e5a1B ${'m'.repeat(50_000)} the end`);

    expect(message).not.toContain('ghp_');
    expect(message.endsWith('the end')).toBe(true);
  });

  it('ingest scrubs a long error in time linear in its length', async () => {
    const started = Date.now();
    await rethrown('https://example.com/acme/repo.git', `${'a'.repeat(4_000_000)}://x@y`);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ingest scrubs the reasons of skipped checkpoints in the artifact', async () => {
    const url = `https://deploy-bot:${TOKEN}@example.com/acme/repo.git`;
    scripted.artifact = { ...twoSessions(), repo: { url, dir: '/data/repos/acme__repo', headSha: 'abc' }, skipped: [{ ref: 'refs/entire/checkpoints/ab/ab1234', reason: `Command failed: git fetch ${url} deadbeef` }] };
    const h = harness({ repoUrl: url });

    const { artifact } = await ingestStage().run(h.ctx());

    expect(artifact.repo.url).toBe('https://example.com/acme/repo.git');
    expect(artifact.skipped).toEqual([{ ref: 'refs/entire/checkpoints/ab/ab1234', reason: 'Command failed: git fetch https://example.com/acme/repo.git deadbeef' }]);
    expect(JSON.stringify(artifact)).not.toContain(TOKEN);
    expect(artifact.sessions).toHaveLength(2);
  });

  it('ingest keeps a token out of the clone directory it reports, when the URL has a one-part path', async () => {
    const url = `https://${TOKEN}@example.com/solo.git`;
    // ingest names the clone after the last two parts of the URL, and here the first of them is the authority
    scripted.artifact = { ...twoSessions(), repo: { url, dir: `/data/repos/${TOKEN}@example.com__solo`, headSha: 'abc' } };
    const h = harness({ repoUrl: url });

    const { artifact } = await ingestStage().run(h.ctx());

    expect(artifact.repo).toEqual({ url: 'https://example.com/solo.git', dir: '/data/repos/[REDACTED]@example.com__solo', headSha: 'abc' });
    expect(JSON.stringify(artifact)).not.toContain(TOKEN);
  });
});
