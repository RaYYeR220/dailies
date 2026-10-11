import { git } from './git';

export interface CheckpointRef {
  id: string;
  treeish: string;
  layout: 'refs' | 'branch';
}

const HEX2 = /^[0-9a-f]{2}$/;
const BRANCH_REF = 'refs/heads/entire/checkpoints/v1';

function lsTreeNames(output: string, typeFilter: 'blob' | 'tree'): string[] {
  const names: string[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const meta = line.slice(0, tabIdx).split(' ');
    if (meta[1] !== typeFilter) continue;
    names.push(line.slice(tabIdx + 1));
  }
  return names;
}

/** Lists every checkpoint found under `refs/entire/checkpoints/*` and the `entire/checkpoints/v1` branch, if present. */
export async function listCheckpointRefs(repoDir: string): Promise<CheckpointRef[]> {
  const refs: CheckpointRef[] = [];

  const refsOut = await git(repoDir, ['for-each-ref', '--format=%(refname)', 'refs/entire/checkpoints/']).catch(() => '');
  for (const refName of refsOut.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const id = refName.split('/').pop()!;
    refs.push({ id, treeish: refName, layout: 'refs' });
  }

  const branchExists = await git(repoDir, ['rev-parse', '--verify', BRANCH_REF]).then(() => true, () => false);
  if (branchExists) {
    const shardNames = lsTreeNames(await git(repoDir, ['ls-tree', BRANCH_REF]), 'tree').filter((n) => HEX2.test(n));
    for (const shard of shardNames) {
      const restNames = lsTreeNames(await git(repoDir, ['ls-tree', `${BRANCH_REF}:${shard}`]), 'tree');
      for (const rest of restNames) {
        refs.push({ id: shard + rest, treeish: `${BRANCH_REF}:${shard}/${rest}`, layout: 'branch' });
      }
    }
  }

  return refs;
}

function checkpointFilePath(ref: CheckpointRef, relPath: string): string {
  return ref.layout === 'refs' ? `${ref.treeish}:${relPath}` : `${ref.treeish}/${relPath}`;
}

async function readCheckpointFile(repoDir: string, ref: CheckpointRef, relPath: string): Promise<string | null> {
  return git(repoDir, ['show', checkpointFilePath(ref, relPath)]).catch(() => null);
}

async function listSessionIndices(repoDir: string, ref: CheckpointRef): Promise<number[]> {
  const out = await git(repoDir, ['ls-tree', ref.treeish]);
  return lsTreeNames(out, 'tree')
    .filter((n) => /^\d+$/.test(n))
    .map(Number)
    .sort((a, b) => a - b);
}

interface RawTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
}

interface RawSessionMetadata {
  session_id: string;
  created_at: string;
  agent?: string;
  model?: string | null;
  branch?: string | null;
  files_touched?: string[];
  token_usage?: RawTokenUsage;
  session_metrics?: { turn_count?: number };
}

export interface RawSession {
  sessionId: string;
  createdAt: string;
  agent: string;
  model: string | null;
  branch: string | null;
  filesTouched: string[];
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turnCount: number;
  transcriptJsonl: string;
}

/** Reads every `<n>/metadata.json` + `<n>/transcript.jsonl` pair under a checkpoint's tree. A malformed session is skipped. */
export async function readCheckpointSessions(repoDir: string, ref: CheckpointRef): Promise<RawSession[]> {
  const indices = await listSessionIndices(repoDir, ref);
  const sessions: RawSession[] = [];

  for (const n of indices) {
    const metaRaw = await readCheckpointFile(repoDir, ref, `${n}/metadata.json`);
    if (!metaRaw) continue;
    let meta: RawSessionMetadata;
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      continue;
    }
    if (!meta.session_id) continue;

    const transcriptJsonl = (await readCheckpointFile(repoDir, ref, `${n}/transcript.jsonl`)) ?? '';
    sessions.push({
      sessionId: meta.session_id,
      createdAt: meta.created_at,
      agent: meta.agent ?? 'unknown',
      model: meta.model ?? null,
      branch: meta.branch ?? null,
      filesTouched: meta.files_touched ?? [],
      tokens: {
        input: meta.token_usage?.input_tokens ?? 0,
        output: meta.token_usage?.output_tokens ?? 0,
        cacheRead: meta.token_usage?.cache_read_tokens ?? 0,
        cacheWrite: meta.token_usage?.cache_creation_tokens ?? 0,
      },
      turnCount: meta.session_metrics?.turn_count ?? 0,
      transcriptJsonl,
    });
  }

  return sessions;
}
