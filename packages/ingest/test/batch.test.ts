import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBlobWithinFetchLimit, ObjectBatchReader } from '../src/git';

function run(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout.toString());
    });
    if (input !== undefined) child.stdin!.end(input);
    else child.stdin!.end();
  });
}

async function initRepo(): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'dailies-batch-'));
  await run(repoDir, ['init', '-q', '-b', 'main']);
  return repoDir;
}

describe('ObjectBatchReader', () => {
  it('returns the same bytes as git show for several objects, including an empty file', async () => {
    const repoDir = await initRepo();
    const contents = ['hello world\n', '', 'x'.repeat(5000), JSON.stringify({ a: 1 })];
    const oids: string[] = [];
    for (const content of contents) {
      oids.push((await run(repoDir, ['hash-object', '-w', '--stdin'], content)).trim());
    }

    const reader = new ObjectBatchReader(repoDir);
    try {
      for (const oid of oids) {
        const viaBatch = await reader.read(oid);
        const viaShow = await run(repoDir, ['show', oid]);
        expect(viaBatch).not.toBeNull();
        expect(viaBatch!.toString('utf8')).toBe(viaShow);
      }
    } finally {
      reader.close();
    }
  });

  it('returns null for an object that does not exist locally', async () => {
    const repoDir = await initRepo();
    const reader = new ObjectBatchReader(repoDir);
    try {
      const result = await reader.read('0'.repeat(40));
      expect(result).toBeNull();
    } finally {
      reader.close();
    }
  });

  it('rejects a pending read instead of hanging when the process dies unexpectedly', async () => {
    // A directory that is not a git repository makes `git cat-file --batch` exit immediately
    // with an error, before ever producing a valid reply header.
    const notARepo = await mkdtemp(join(tmpdir(), 'dailies-notrepo-'));
    const reader = new ObjectBatchReader(notARepo);
    await expect(reader.read('a'.repeat(40))).rejects.toThrow();
    reader.close();
  });
});

describe('assertBlobWithinFetchLimit', () => {
  it('passes for a blob within the limit and throws for one over it', async () => {
    const repoDir = await initRepo();
    const smallOid = (await run(repoDir, ['hash-object', '-w', '--stdin'], 'tiny')).trim();
    const bigOid = (await run(repoDir, ['hash-object', '-w', '--stdin'], 'x'.repeat(5000))).trim();

    await expect(assertBlobWithinFetchLimit(repoDir, smallOid, 1000)).resolves.toBeUndefined();
    await expect(assertBlobWithinFetchLimit(repoDir, bigOid, 1000)).rejects.toThrow(/over the 1000-byte fetch limit/);
  });
});
