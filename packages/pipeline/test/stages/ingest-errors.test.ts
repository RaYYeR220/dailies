import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingestStage } from '../../src/stages/ingest';
import { cleanup, harness } from './fixture';

// Only the error path is under test here, with messages git would not produce on demand.
const failure = { message: '' };
vi.mock('@dailies/ingest', () => ({
  NoCheckpointsError: class NoCheckpointsError extends Error {},
  ingest: async () => {
    throw new Error(failure.message);
  },
}));

afterEach(cleanup);

const TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const rethrown = async (repoUrl: string, message: string) => {
  failure.message = message;
  const h = harness({ repoUrl });
  return ingestStage().run(h.ctx()).then(() => { throw new Error('the stage did not fail'); }, (err: Error) => err.message);
};

describe('ingest stage errors', () => {
  it('ingest removes the URL credentials from an error even where they stand outside a URL', async () => {
    const message = await rethrown(`https://deploy-bot:${TOKEN}@example.com/acme/repo.git`, `fatal: Authentication failed for user deploy-bot with password ${TOKEN}`);

    expect(message).toBe('fatal: Authentication failed for user [REDACTED] with password [REDACTED]');
  });

  it('ingest removes credentials that the URL carries percent-encoded', async () => {
    const message = await rethrown('https://deploy-bot:s3cr%40t%2Fvalue@example.com/acme/repo.git', 'fatal: bad password s3cr@t/value (sent as s3cr%40t%2Fvalue)');

    expect(message).toBe('fatal: bad password [REDACTED] (sent as [REDACTED])');
  });

  it('ingest bounds a huge error message and still redacts a secret that sits on the cut', async () => {
    const head = `${'h'.repeat(990)} ${TOKEN} `;   // the token straddles character 1000
    const message = await rethrown('https://example.com/acme/repo.git', `${head}${'m'.repeat(2_000_000)} tail says fatal: unable to access the remote`);

    expect(message.length).toBeLessThanOrEqual(2010);
    expect(message.startsWith('h'.repeat(990))).toBe(true);
    expect(message.endsWith('fatal: unable to access the remote')).toBe(true);
    expect(message).not.toContain('ghp_');
    expect(message).not.toContain('a1B2c3D4e5');
  });

  it('ingest scrubs a long error in time linear in its length', async () => {
    const started = Date.now();
    await rethrown('https://example.com/acme/repo.git', `${'a'.repeat(4_000_000)}://x@y`);

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
