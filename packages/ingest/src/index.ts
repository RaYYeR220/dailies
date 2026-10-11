import type { IngestArtifact, Session } from '@dailies/core';
import { listCheckpointRefs, readCheckpointSessions, type CheckpointRef } from './checkpoints';
import { cloneOrUpdate, getDiff, git } from './git';
import { mapCheckpointCommits } from './trailers';
import { parseTranscript } from './transcript';
import { mergeSessions, selectWindow } from './window';

export { git, cloneOrUpdate, getDiff } from './git';
export { listCheckpointRefs } from './checkpoints';
export type { CheckpointRef } from './checkpoints';
export { parseTranscript } from './transcript';
export { mapCheckpointCommits } from './trailers';

const DEFAULT_MAX_SESSIONS = 12;

export class NoCheckpointsError extends Error {}

async function buildSessionsForCheckpoint(repoDir: string, ref: CheckpointRef, commits: string[]): Promise<{ sessions: Session[]; redactions: number }> {
  const raw = await readCheckpointSessions(repoDir, ref);
  const sessions: Session[] = [];
  let redactions = 0;

  for (const r of raw) {
    const { entries, redactions: hits } = parseTranscript(r.sessionId, r.transcriptJsonl);
    redactions += hits;
    const startedAt = entries[0]?.ts ?? r.createdAt;
    const endedAt = entries.length > 0 ? entries[entries.length - 1]!.ts : null;
    sessions.push({
      id: r.sessionId,
      checkpointIds: [ref.id],
      agent: r.agent,
      model: r.model,
      branch: r.branch,
      startedAt,
      endedAt,
      turnCount: r.turnCount,
      tokens: r.tokens,
      commits,
      filesTouched: r.filesTouched,
      entries,
    });
  }

  return { sessions, redactions };
}

/** Reads a repository's Entire checkpoints into normalized sessions for the given window. */
export async function ingest(opts: {
  repoUrl: string;
  dataDir: string;
  since: string;
  until: string;
  maxSessions?: number;
}): Promise<IngestArtifact> {
  const repoDir = await cloneOrUpdate(opts.repoUrl, opts.dataDir);
  const refs = await listCheckpointRefs(repoDir);
  if (refs.length === 0) throw new NoCheckpointsError(`no checkpoint refs found in ${opts.repoUrl}`);

  const commitMap = await mapCheckpointCommits(repoDir);
  const skipped: { ref: string; reason: string }[] = [];
  let allSessions: Session[] = [];
  let redactions = 0;

  for (const ref of refs) {
    try {
      const commits = commitMap.get(ref.id) ?? [];
      const built = await buildSessionsForCheckpoint(repoDir, ref, commits);
      allSessions = allSessions.concat(built.sessions);
      redactions += built.redactions;
    } catch (err) {
      skipped.push({ ref: ref.treeish, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const merged = mergeSessions(allSessions);
  const windowed = selectWindow(merged, opts.since, opts.until, opts.maxSessions ?? DEFAULT_MAX_SESSIONS);

  const commitShas = Array.from(new Set(windowed.flatMap((s) => s.commits)));
  const diffs: Record<string, string> = {};
  for (const sha of commitShas) {
    const fileDiffs = await getDiff(repoDir, sha);
    for (const [path, patch] of Object.entries(fileDiffs)) diffs[`${sha}:${path}`] = patch;
  }

  const headSha = await git(repoDir, ['rev-parse', 'HEAD']).then((s) => s.trim()).catch(() => '');

  return {
    repo: { url: opts.repoUrl, dir: repoDir, headSha },
    sessions: windowed,
    diffs,
    skipped,
    enrichments: {},
    redactions,
  };
}
