import type { IngestArtifact, Session } from '@dailies/core';
import { readSessionCache, sessionCachePath, writeSessionCache } from './cache';
import { listCheckpointRefs, readCheckpointMetadata, readSessionTranscriptText, type CheckpointRef, type SessionMetaOnly } from './checkpoints';
import { cloneOrUpdate, getDiffsBatched, git, ObjectBatchReader } from './git';
import { mapCheckpointCommits } from './trailers';
import { parseTranscript } from './transcript';
import { mergeSessions, selectCandidateSessionIds, selectWindow } from './window';

export { git, cloneOrUpdate, getDiff } from './git';
export { listCheckpointRefs } from './checkpoints';
export type { CheckpointRef } from './checkpoints';
export { parseTranscript } from './transcript';
export { mapCheckpointCommits } from './trailers';

const DEFAULT_MAX_SESSIONS = 12;
const MAX_DIFF_COMMITS = 60;

export class NoCheckpointsError extends Error {}

interface MetaRecord {
  ref: CheckpointRef;
  meta: SessionMetaOnly;
}

async function buildSession(
  repoDir: string,
  dataDir: string,
  reader: ObjectBatchReader,
  record: MetaRecord,
  commits: string[],
): Promise<{ session: Session; redactions: number }> {
  const { ref, meta } = record;
  const cachePath = sessionCachePath(dataDir, ref.id, meta.sessionIndex);
  const cached = await readSessionCache(cachePath, meta.transcriptOid);

  let entries: Session['entries'];
  let redactions: number;
  if (cached) {
    entries = cached.entries;
    redactions = cached.redactions;
  } else {
    const jsonl = await readSessionTranscriptText(repoDir, meta.transcriptOid, reader);
    const parsed = parseTranscript(meta.sessionId, jsonl);
    entries = parsed.entries;
    redactions = parsed.redactions;
    if (meta.transcriptOid) await writeSessionCache(cachePath, { transcriptOid: meta.transcriptOid, entries, redactions });
  }

  const startedAt = entries[0]?.ts ?? meta.createdAt;
  const endedAt = entries.length > 0 ? entries[entries.length - 1]!.ts : null;

  return {
    session: {
      id: meta.sessionId,
      checkpointIds: [ref.id],
      agent: meta.agent,
      model: meta.model,
      branch: meta.branch,
      startedAt,
      endedAt,
      turnCount: meta.turnCount,
      tokens: meta.tokens,
      commits,
      filesTouched: meta.filesTouched,
      entries,
    },
    redactions,
  };
}

/** Reads a repository's Entire checkpoints into normalized sessions for the given window. */
export async function ingest(opts: {
  repoUrl: string;
  dataDir: string;
  since: string;
  until: string;
  maxSessions?: number;
  onProgress?: (message: string) => void;
}): Promise<IngestArtifact> {
  const onProgress = opts.onProgress ?? (() => undefined);
  const maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;

  onProgress('cloning');
  const repoDir = await cloneOrUpdate(opts.repoUrl, opts.dataDir);
  const refs = await listCheckpointRefs(repoDir);
  if (refs.length === 0) throw new NoCheckpointsError(`no checkpoint refs found in ${opts.repoUrl}`);
  onProgress(`read ${refs.length} checkpoints`);

  const commitMap = await mapCheckpointCommits(repoDir);
  const skipped: { ref: string; reason: string }[] = [];
  const reader = new ObjectBatchReader(repoDir);

  try {
    const metaRecords: MetaRecord[] = [];
    for (const ref of refs) {
      try {
        const metas = await readCheckpointMetadata(repoDir, ref, reader);
        for (const meta of metas) metaRecords.push({ ref, meta });
      } catch (err) {
        skipped.push({ ref: ref.treeish, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const survivorIds = selectCandidateSessionIds(
      metaRecords.map((r) => ({ sessionId: r.meta.sessionId, createdAt: r.meta.createdAt })),
      opts.since,
      opts.until,
      maxSessions,
    );
    onProgress(`${survivorIds.size} sessions in window`);

    const toRead = metaRecords.filter((r) => survivorIds.has(r.meta.sessionId));
    let allSessions: Session[] = [];
    let redactions = 0;
    for (let i = 0; i < toRead.length; i += 1) {
      const record = toRead[i]!;
      onProgress(`parsing ${i + 1}/${toRead.length}`);
      try {
        const commits = commitMap.get(record.ref.id) ?? [];
        const built = await buildSession(repoDir, opts.dataDir, reader, record, commits);
        allSessions.push(built.session);
        redactions += built.redactions;
      } catch (err) {
        skipped.push({
          ref: `${record.ref.treeish}#${record.meta.sessionIndex}`,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const merged = mergeSessions(allSessions);
    const windowed = selectWindow(merged, opts.since, opts.until, maxSessions);

    const commitShas = Array.from(new Set(windowed.flatMap((s) => s.commits)));
    const cappedCount = Math.min(commitShas.length, MAX_DIFF_COMMITS);
    onProgress(`diffs for ${cappedCount} commits`);
    const { diffs, droppedCount } = await getDiffsBatched(repoDir, commitShas, MAX_DIFF_COMMITS);
    if (droppedCount > 0) skipped.push({ ref: 'diffs', reason: `${droppedCount} commit diff(s) dropped past the ${MAX_DIFF_COMMITS}-commit cap` });

    const headSha = await git(repoDir, ['rev-parse', 'HEAD']).then((s) => s.trim()).catch(() => '');

    return {
      repo: { url: opts.repoUrl, dir: repoDir, headSha },
      sessions: windowed,
      diffs,
      skipped,
      enrichments: {},
      redactions,
    };
  } finally {
    reader.close();
  }
}
