import { git } from './git';

const TRAILER_RE = /^Entire-Checkpoint:\s*(\S+)\s*$/m;
const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

function extractCheckpointId(message: string): string | null {
  const m = TRAILER_RE.exec(message);
  return m ? m[1]! : null;
}

// NUL cannot appear inside a git commit's sha or message, so it is a collision-proof field and
// record separator against commit bodies from an untrusted, cloned public repository.
/** Maps checkpoint id -> commit SHAs by scanning commit bodies for an `Entire-Checkpoint:` trailer. */
export async function mapCheckpointCommits(repoDir: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  let out: string;
  try {
    out = await git(repoDir, ['log', '-z', '--exclude=refs/heads/entire/*', '--branches', '--tags', '--format=%H%x00%B']);
  } catch {
    return map;
  }

  const fields = out.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const sha = fields[i]!.replace(/^\n+/, '').trim();
    const body = fields[i + 1]!;
    if (!SHA_RE.test(sha)) continue;
    const id = extractCheckpointId(body);
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(sha);
    map.set(id, list);
  }

  return map;
}
