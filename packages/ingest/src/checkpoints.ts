import { git, readBlobOrFetch, type ObjectBatchReader } from './git';

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

export interface SessionMetaOnly {
  sessionIndex: number;
  sessionId: string;
  createdAt: string;
  agent: string;
  model: string | null;
  branch: string | null;
  filesTouched: string[];
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  turnCount: number;
  transcriptOid: string | null;
}

const SESSION_FILE_RE = /^(\d+)\/(metadata\.json|transcript\.jsonl)$/;
// A real checkpoint has a handful of sessions; this only exists to bound how many session
// indexes a single crafted checkpoint tree (from an untrusted cloned repo) can make the ingest
// attempt to read, fetch, or report in `skipped`.
const MAX_SESSIONS_PER_CHECKPOINT = 1000;

/** One recursive `ls-tree` walk of the checkpoint's tree, giving the blob id of every session's metadata and transcript. */
async function listSessionBlobs(
  repoDir: string,
  ref: CheckpointRef,
  maxSessions = MAX_SESSIONS_PER_CHECKPOINT,
): Promise<Map<number, { metaOid?: string; transcriptOid?: string }>> {
  const out = await git(repoDir, ['ls-tree', '-r', ref.treeish]);
  const byIndex = new Map<number, { metaOid?: string; transcriptOid?: string }>();

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const tabIdx = line.indexOf('\t');
    if (tabIdx === -1) continue;
    const info = line.slice(0, tabIdx).split(' ');
    if (info[1] !== 'blob') continue;
    const sha = info[2];
    const path = line.slice(tabIdx + 1);
    const m = SESSION_FILE_RE.exec(path);
    if (!m || !sha) continue;
    const n = Number(m[1]);
    if (!byIndex.has(n) && byIndex.size >= maxSessions) continue;
    const entry = byIndex.get(n) ?? {};
    if (m[2] === 'metadata.json') entry.metaOid = sha;
    else entry.transcriptOid = sha;
    byIndex.set(n, entry);
  }

  return byIndex;
}

export interface CheckpointMetadataResult {
  sessions: SessionMetaOnly[];
  // A metadata.json that simply doesn't exist for a session index is not reported here (that's
  // normal, sparse layout); a metadata.json that exists but couldn't actually be read — a fetch
  // failure, a size-cap rejection, a desynchronized reader — is, so one bad blob never silently
  // erases sessions from the result without a trace.
  skipped: { ref: string; reason: string }[];
}

/**
 * Reads only the small `<n>/metadata.json` file for every session in a checkpoint, through the
 * shared batch reader, without opening any `transcript.jsonl`. A malformed session (bad JSON, no
 * session_id) is skipped silently, as in Task 2; a session whose metadata blob exists but could
 * not actually be read is skipped and reported.
 */
export async function readCheckpointMetadata(
  repoDir: string,
  ref: CheckpointRef,
  reader: ObjectBatchReader,
  maxSessions = MAX_SESSIONS_PER_CHECKPOINT,
): Promise<CheckpointMetadataResult> {
  const byIndex = await listSessionBlobs(repoDir, ref, maxSessions);
  const sessions: SessionMetaOnly[] = [];
  const skipped: { ref: string; reason: string }[] = [];

  for (const [n, entry] of Array.from(byIndex.entries()).sort((a, b) => a[0] - b[0])) {
    if (!entry.metaOid) continue;
    let metaBuf: Buffer;
    try {
      metaBuf = await readBlobOrFetch(repoDir, reader, entry.metaOid);
    } catch (err) {
      skipped.push({ ref: `${ref.treeish}#${n}`, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    let meta: RawSessionMetadata;
    try {
      meta = JSON.parse(metaBuf.toString('utf8'));
    } catch {
      continue;
    }
    if (!meta.session_id) continue;

    sessions.push({
      sessionIndex: n,
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
      transcriptOid: entry.transcriptOid ?? null,
    });
  }

  return { sessions, skipped };
}

/** Reads a session's `transcript.jsonl` text through the shared batch reader. No transcript blob gives `''`, as before. */
export async function readSessionTranscriptText(
  repoDir: string,
  transcriptOid: string | null,
  reader: ObjectBatchReader,
): Promise<string> {
  if (!transcriptOid) return '';
  const buf = await readBlobOrFetch(repoDir, reader, transcriptOid);
  return buf.toString('utf8');
}
