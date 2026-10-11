import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { redactBounded } from './transcript';

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

export async function git(repoDir: string, args: string[], opts?: { maxBuffer?: number }): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      { cwd: repoDir, maxBuffer: opts?.maxBuffer ?? DEFAULT_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString() || err.message));
        else resolvePromise(stdout.toString());
      },
    );
  });
}

function isRemoteUrl(repoUrlOrPath: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(repoUrlOrPath);
}

function repoDirName(repoUrlOrPath: string): string {
  const cleaned = repoUrlOrPath.replace(/\.git$/, '');
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.slice(-2).join('__');
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

/** Clones a URL under `<dataDir>/repos/<owner>__<name>` (or fetches if already cloned); a local path is used in place. */
export async function cloneOrUpdate(repoUrlOrPath: string, dataDir: string): Promise<string> {
  if (!isRemoteUrl(repoUrlOrPath)) return resolve(repoUrlOrPath);

  const reposDir = resolve(dataDir, 'repos');
  await mkdir(reposDir, { recursive: true });
  const repoDir = resolve(reposDir, repoDirName(repoUrlOrPath));

  if (await pathExists(repoDir)) {
    await git(repoDir, ['fetch', 'origin']).catch(() => undefined);
  } else {
    await new Promise<void>((resolvePromise, reject) => {
      execFile(
        'git',
        ['clone', '--filter=blob:limit=3m', repoUrlOrPath, repoDir],
        { cwd: reposDir, maxBuffer: DEFAULT_MAX_BUFFER },
        (err) => (err ? reject(err) : resolvePromise()),
      );
    });
  }

  await git(repoDir, ['fetch', 'origin', '+refs/entire/*:refs/entire/*']).catch(() => undefined);
  await git(repoDir, ['fetch', 'origin', '+refs/heads/entire/*:refs/remotes/origin/entire/*']).catch(() => undefined);

  return repoDir;
}

const MAX_DIFF_FILES = 40;
const MAX_DIFF_COMMITS = 60;
const MAX_PATCH_CHARS = 6000;
// Larger than any realistic single secret match, so a secret sitting right at the truncation
// cut is still fully visible to redact() before that cut is made; bounds the pre-redaction
// window so redact() never scans an arbitrarily large patch from an untrusted clone.
const SAFETY_MARGIN = 8192;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Splits one commit's `-p` patch body into redacted, length-capped text per changed file. */
function patchBodyToFileMap(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const chunks = body.split(/(?=^diff --git )/m).filter((c) => c.startsWith('diff --git'));
  for (const chunk of chunks.slice(0, MAX_DIFF_FILES)) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(chunk);
    const path = headerMatch?.[2];
    if (!path) continue;
    const bounded = chunk.length <= MAX_PATCH_CHARS + SAFETY_MARGIN ? chunk : chunk.slice(0, MAX_PATCH_CHARS + SAFETY_MARGIN);
    result[path] = redactBounded(bounded).text.slice(0, MAX_PATCH_CHARS);
  }
  return result;
}

/** Returns the redacted patch text for every file changed by `sha`, keyed by path, each capped at 6000 characters. */
export async function getDiff(repoDir: string, sha: string): Promise<Record<string, string>> {
  if (!SHA_RE.test(sha)) return {};
  let out: string;
  try {
    out = await git(repoDir, ['diff-tree', '-p', '--no-color', '--no-commit-id', '--root', sha]);
  } catch {
    return {};
  }
  return patchBodyToFileMap(out);
}

/**
 * Returns the same per-file patches as calling `getDiff` for each sha, but with one `git log`
 * process for every commit instead of one per commit. Commits are kept in git's own most-recent-
 * first order and capped at 60; `droppedCount` reports how many older commits were left out.
 */
export async function getDiffsBatched(
  repoDir: string,
  shas: string[],
  maxCommits = MAX_DIFF_COMMITS,
): Promise<{ diffs: Record<string, string>; droppedCount: number }> {
  const validShas = shas.filter((sha) => SHA_RE.test(sha));
  if (validShas.length === 0) return { diffs: {}, droppedCount: 0 };

  let out: string;
  try {
    out = await git(repoDir, ['log', '-p', '--no-color', '--no-walk=sorted', '--format=%x00%H%x00', ...validShas]);
  } catch {
    return { diffs: {}, droppedCount: 0 };
  }

  const fields = out.split('\0');
  const commits: { sha: string; body: string }[] = [];
  for (let i = 1; i + 1 < fields.length; i += 2) {
    const sha = fields[i]!.trim();
    const body = fields[i + 1]!;
    if (SHA_RE.test(sha)) commits.push({ sha, body });
  }

  const kept = commits.slice(0, maxCommits);
  const droppedCount = Math.max(0, commits.length - maxCommits);

  const diffs: Record<string, string> = {};
  for (const { sha, body } of kept) {
    for (const [path, patch] of Object.entries(patchBodyToFileMap(body))) diffs[`${sha}:${path}`] = patch;
  }
  return { diffs, droppedCount };
}

/** A long-lived `git cat-file --batch` process: write an object id, read its full content back. */
export class ObjectBatchReader {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending: Array<{ resolve: (buf: Buffer | null) => void; reject: (err: Error) => void }> = [];
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(repoDir: string) {
    this.proc = spawn('git', ['cat-file', '--batch'], {
      cwd: repoDir,
      // Promisor objects outside a partial clone's filter would otherwise be fetched one at a
      // time, each a network round trip; this makes cat-file report them missing instead so the
      // caller can decide whether to fetch, in one explicit step.
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    });
    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    const failAll = (err: Error) => {
      while (this.pending.length > 0) this.pending.shift()!.reject(err);
    };
    this.proc.on('error', failAll);
    this.proc.stdin.on('error', failAll);
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const nl = this.buffer.indexOf(0x0a);
      if (nl === -1) return;
      const header = this.buffer.subarray(0, nl).toString('utf8');
      if (header.endsWith(' missing')) {
        this.buffer = this.buffer.subarray(nl + 1);
        this.pending.shift()!.resolve(null);
        continue;
      }
      const m = /^[0-9a-f]{40,64} \S+ (\d+)$/.exec(header);
      if (!m) {
        this.buffer = this.buffer.subarray(nl + 1);
        continue;
      }
      const size = Number(m[1]);
      const need = nl + 1 + size + 1;
      if (this.buffer.length < need) return;
      const data = Buffer.from(this.buffer.subarray(nl + 1, nl + 1 + size));
      this.buffer = this.buffer.subarray(need);
      this.pending.shift()!.resolve(data);
    }
  }

  /** Resolves with the object's content, or `null` when the object is missing locally. */
  read(oid: string): Promise<Buffer | null> {
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolvePromise, reject) => {
      this.pending.push({ resolve: resolvePromise, reject });
      this.proc.stdin.write(`${oid}\n`);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/** Reads a blob through the batch reader; a blob missing locally (beyond the clone filter) is fetched once and retried. */
export async function readBlobOrFetch(repoDir: string, reader: ObjectBatchReader, oid: string): Promise<Buffer> {
  const first = await reader.read(oid);
  if (first !== null) return first;
  await git(repoDir, ['fetch', 'origin', oid]);
  const second = await reader.read(oid);
  if (second === null) throw new Error(`object ${oid} is unavailable even after fetching it`);
  return second;
}
