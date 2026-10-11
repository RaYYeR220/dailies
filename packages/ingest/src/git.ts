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
// Never run an external diff driver or textconv filter the cloned repo's own .gitattributes
// might name: those require a matching command defined in local/global git config to do
// anything, which an untrusted clone cannot supply on its own, but there is no reason to leave
// the door open.
const DIFF_SAFE_FLAGS = ['--no-textconv', '--no-ext-diff'];

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
    out = await git(repoDir, ['diff-tree', '-p', '--no-color', '--no-commit-id', '--root', ...DIFF_SAFE_FLAGS, sha]);
  } catch {
    return {};
  }
  return patchBodyToFileMap(out);
}

/** Sorts shas by git's own commit-timestamp order (most recent first) with one lightweight, body-free call. */
async function sortByRecency(repoDir: string, shas: string[]): Promise<string[]> {
  let out: string;
  try {
    out = await git(repoDir, ['log', '--no-walk=sorted', '--format=%H', ...shas]);
  } catch {
    return shas;
  }
  return out.split('\n').map((s) => s.trim()).filter((s) => SHA_RE.test(s));
}

/** The one-process-per-commit fallback `getDiffsBatched` uses when its batched parse looks untrustworthy. */
export async function getDiffsPerCommit(
  repoDir: string,
  shas: string[],
  maxCommits: number,
): Promise<{ diffs: Record<string, string>; droppedCount: number }> {
  const ordered = await sortByRecency(repoDir, shas);
  const kept = ordered.slice(0, maxCommits);
  const droppedCount = Math.max(0, ordered.length - maxCommits);

  const diffs: Record<string, string> = {};
  for (const sha of kept) {
    for (const [path, patch] of Object.entries(await getDiff(repoDir, sha))) diffs[`${sha}:${path}`] = patch;
  }
  return { diffs, droppedCount };
}

/**
 * True when every requested sha was parsed out of the batched `git log` output exactly once,
 * with nothing unexpected. A patch body that somehow contained the `\0` field separator (git's
 * own binary-content heuristic means this does not happen through ordinary diffed file content,
 * absent `-a`/`--text`/textconv, none of which this module uses) would desynchronize the
 * positional pairing below; this check exists so that, if it ever did, the result is a safe
 * fallback rather than silently mismatched or dropped diffs.
 */
function parsedCommitsAreTrustworthy(parsed: { sha: string }[], requested: string[]): boolean {
  if (parsed.length !== requested.length) return false;
  const requestedSet = new Set(requested);
  const seen = new Set<string>();
  for (const { sha } of parsed) {
    if (!requestedSet.has(sha) || seen.has(sha)) return false;
    seen.add(sha);
  }
  return true;
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
  const validShas = Array.from(new Set(shas.filter((sha) => SHA_RE.test(sha))));
  if (validShas.length === 0) return { diffs: {}, droppedCount: 0 };

  let out: string;
  try {
    out = await git(repoDir, ['log', '-p', '--no-color', '--no-walk=sorted', ...DIFF_SAFE_FLAGS, '--format=%x00%H%x00', ...validShas]);
  } catch {
    return getDiffsPerCommit(repoDir, validShas, maxCommits);
  }

  const fields = out.split('\0');
  const commits: { sha: string; body: string }[] = [];
  for (let i = 1; i + 1 < fields.length; i += 2) {
    commits.push({ sha: fields[i]!.trim(), body: fields[i + 1]! });
  }

  if (!parsedCommitsAreTrustworthy(commits, validShas)) return getDiffsPerCommit(repoDir, validShas, maxCommits);

  const kept = commits.slice(0, maxCommits);
  const droppedCount = Math.max(0, commits.length - maxCommits);

  const diffs: Record<string, string> = {};
  for (const { sha, body } of kept) {
    for (const [path, patch] of Object.entries(patchBodyToFileMap(body))) diffs[`${sha}:${path}`] = patch;
  }
  return { diffs, droppedCount };
}

const MAX_FETCHED_BLOB_SIZE = 20 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;

/** Throws when an object's size (as git reports it) is over the limit, without reading its content. */
export async function assertBlobWithinFetchLimit(repoDir: string, oid: string, maxBytes = MAX_FETCHED_BLOB_SIZE): Promise<void> {
  const sizeOut = await git(repoDir, ['cat-file', '-s', oid]).catch(() => null);
  const size = sizeOut === null ? NaN : Number(sizeOut.trim());
  if (Number.isFinite(size) && size > maxBytes) {
    throw new Error(`object ${oid} is ${size} bytes, over the ${maxBytes}-byte fetch limit`);
  }
}

interface PendingRead {
  resolve: (buf: Buffer | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** An object whose body is being accumulated, within the size cap. */
interface InFlightBody {
  size: number;
  collected: Buffer[];
  have: number;
}

/** A long-lived `git cat-file --batch` process: write an object id, read its full content back. */
export class ObjectBatchReader {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending: PendingRead[] = [];
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;
  // Set once the reply stream can no longer be trusted to line up with pending requests at all
  // (a process exit or an unparseable header, as opposed to one oversized object, which is
  // handled per-request below); every read from this point on fails fast instead of risking a
  // later reply being resolved against the wrong pending request.
  private desynced = false;
  private readonly maxObjectSize: number;
  // Bytes still to be discarded from an oversized object's body, tracked by count rather than
  // buffered, so refusing one large object can never itself grow memory with its content.
  private skipRemaining = 0;
  private body: InFlightBody | null = null;

  constructor(repoDir: string, maxObjectSize = MAX_FETCHED_BLOB_SIZE) {
    this.maxObjectSize = maxObjectSize;
    this.proc = spawn('git', ['cat-file', '--batch'], {
      cwd: repoDir,
      // Promisor objects outside a partial clone's filter would otherwise be fetched one at a
      // time, each a network round trip; this makes cat-file report them missing instead so the
      // caller can decide whether to fetch, in one explicit step.
      env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    });
    this.proc.stdout.on('data', (chunk: Buffer) => {
      if (this.desynced) return; // the stream is torn down on poison(); nothing left to do with it
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    const dead = (detail: string) => this.poison(new Error(`git cat-file --batch ${detail}`));
    this.proc.on('error', (err) => dead(`failed: ${err.message}`));
    this.proc.stdin.on('error', (err) => dead(`stdin failed: ${err.message}`));
    this.proc.on('exit', (code, signal) => {
      if (!this.closed) dead(`exited unexpectedly (code ${code}, signal ${signal})`);
    });
    this.proc.stdout.on('end', () => {
      if (!this.closed) dead('closed its output unexpectedly');
    });
  }

  /** Tears the reader down entirely: every *other* pending request fails too, since the reply stream can no longer be trusted to line up with them. */
  private poison(err: Error): void {
    if (this.desynced) return;
    this.desynced = true;
    this.buffer = Buffer.alloc(0);
    this.body = null;
    this.skipRemaining = 0;
    this.proc.stdout.removeAllListeners('data');
    if (!this.closed) {
      this.closed = true;
      this.proc.stdin.end();
      this.proc.kill();
    }
    while (this.pending.length > 0) {
      const next = this.pending.shift()!;
      clearTimeout(next.timer);
      next.reject(err);
    }
  }

  private drain(): void {
    while (true) {
      if (this.skipRemaining > 0) {
        const take = Math.min(this.skipRemaining, this.buffer.length);
        this.buffer = this.buffer.subarray(take);
        this.skipRemaining -= take;
        if (this.skipRemaining > 0) return;
        continue;
      }

      if (this.body) {
        const need = this.body.size + 1 - this.body.have; // +1 for the trailing newline after content
        const take = Math.min(need, this.buffer.length);
        if (take > 0) {
          this.body.collected.push(Buffer.from(this.buffer.subarray(0, take)));
          this.body.have += take;
          this.buffer = this.buffer.subarray(take);
        }
        if (this.body.have < this.body.size + 1) return;
        const data = Buffer.concat(this.body.collected).subarray(0, this.body.size);
        this.body = null;
        const next = this.pending.shift()!;
        clearTimeout(next.timer);
        next.resolve(data);
        continue;
      }

      if (this.pending.length === 0) return;
      const nl = this.buffer.indexOf(0x0a);
      if (nl === -1) return;
      const header = this.buffer.subarray(0, nl).toString('utf8');
      this.buffer = this.buffer.subarray(nl + 1);

      if (header.endsWith(' missing')) {
        const next = this.pending.shift()!;
        clearTimeout(next.timer);
        next.resolve(null);
        continue;
      }
      const m = /^[0-9a-f]{40,64} \S+ (\d+)$/.exec(header);
      if (!m) {
        // The reply no longer lines up with what cat-file's protocol promises; trust nothing
        // further rather than guessing where the next real header starts.
        this.poison(new Error(`git cat-file --batch sent an unparseable reply header: ${JSON.stringify(header)}`));
        return;
      }
      const size = Number(m[1]);
      if (size > this.maxObjectSize) {
        // Fail only this one request and discard its body by count, without buffering it: a
        // single oversized object must not take the whole reader (and every other session still
        // being read through it) down with it.
        const next = this.pending.shift()!;
        clearTimeout(next.timer);
        next.reject(new Error(`git cat-file --batch reported an object of ${size} bytes, over the ${this.maxObjectSize}-byte read limit`));
        this.skipRemaining = size + 1;
        continue;
      }
      this.body = { size, collected: [], have: 0 };
    }
  }

  /** Resolves with the object's content, or `null` when the object is missing locally. */
  read(oid: string): Promise<Buffer | null> {
    if (this.closed) return Promise.resolve(null);
    if (this.desynced) return Promise.reject(new Error('git cat-file --batch reader is desynchronized and no longer usable'));
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.resolve === resolvePromise);
        if (idx !== -1) this.pending.splice(idx, 1);
        this.poison(new Error(`git cat-file --batch read of ${oid} timed out after ${READ_TIMEOUT_MS}ms`));
      }, READ_TIMEOUT_MS);
      this.pending.push({ resolve: resolvePromise, reject, timer });
      this.proc.stdin.write(`${oid}\n`);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending) clearTimeout(p.timer);
    this.proc.stdin.end();
    this.proc.kill();
  }
}

/**
 * Reads a blob through the batch reader; a blob missing locally (beyond the clone filter) is
 * fetched once and retried, after checking its size stays within `assertBlobWithinFetchLimit` —
 * the content is untrusted, so an unbounded fetch-and-buffer here would let a single oversized
 * blob exhaust memory or bandwidth.
 */
export async function readBlobOrFetch(repoDir: string, reader: ObjectBatchReader, oid: string): Promise<Buffer> {
  const first = await reader.read(oid);
  if (first !== null) return first;
  await git(repoDir, ['fetch', 'origin', oid]);
  await assertBlobWithinFetchLimit(repoDir, oid);
  const second = await reader.read(oid);
  if (second === null) throw new Error(`object ${oid} is unavailable even after fetching it`);
  return second;
}
