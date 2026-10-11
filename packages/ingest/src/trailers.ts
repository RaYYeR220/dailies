import { git } from './git';

const TRAILER_RE = /^Entire-Checkpoint:\s*(\S+)\s*$/m;

function extractCheckpointId(message: string): string | null {
  const m = TRAILER_RE.exec(message);
  return m ? m[1]! : null;
}

const SEP = '\u001e';
const END = '\u001d';

/** Maps checkpoint id -> commit SHAs by scanning commit bodies for an `Entire-Checkpoint:` trailer. */
export async function mapCheckpointCommits(repoDir: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  let out: string;
  try {
    out = await git(repoDir, [
      'log',
      '--exclude=refs/heads/entire/*',
      '--branches',
      '--tags',
      `--format=%H${SEP}%B${END}`,
    ]);
  } catch {
    return map;
  }

  for (const record of out.split(END)) {
    const trimmed = record.replace(/^\n+/, '');
    if (!trimmed.trim()) continue;
    const sepIdx = trimmed.indexOf(SEP);
    if (sepIdx === -1) continue;
    const sha = trimmed.slice(0, sepIdx);
    const body = trimmed.slice(sepIdx + 1);
    const id = extractCheckpointId(body);
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(sha);
    map.set(id, list);
  }

  return map;
}
