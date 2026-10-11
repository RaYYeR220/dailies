import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

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
        ['clone', '--filter=blob:none', repoUrlOrPath, repoDir],
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
const MAX_PATCH_CHARS = 6000;

/** Returns the patch text for every file changed by `sha`, keyed by path, each capped at 6000 characters. */
export async function getDiff(repoDir: string, sha: string): Promise<Record<string, string>> {
  let out: string;
  try {
    out = await git(repoDir, ['diff-tree', '-p', '--no-color', '--no-commit-id', '--root', sha]);
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const chunks = out.split(/(?=^diff --git )/m).filter((c) => c.startsWith('diff --git'));
  for (const chunk of chunks.slice(0, MAX_DIFF_FILES)) {
    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(chunk);
    const path = headerMatch?.[2];
    if (!path) continue;
    result[path] = chunk.slice(0, MAX_PATCH_CHARS);
  }
  return result;
}
