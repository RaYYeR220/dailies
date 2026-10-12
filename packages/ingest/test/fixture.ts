import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FixtureBlock {
  [key: string]: unknown;
  type?: string;
}

export interface FixtureLine {
  type: 'user' | 'assistant';
  ts?: string;
  content: FixtureBlock[];
}

export interface FixtureSession {
  sessionId: string;
  createdAt: string;
  lines: FixtureLine[];
  /** A headless session's metadata.json carries no session_metrics, so no turn_count either. */
  headless?: boolean;
  /** Overrides the metadata's turn_count; defaults to lines.length. */
  turnCount?: number;
}

export interface FixtureCheckpoint {
  id: string;
  sessions: FixtureSession[];
}

export interface FixtureSpec {
  layout: 'refs' | 'branch';
  checkpoints: FixtureCheckpoint[];
}

type FileNode = { kind: 'blob'; sha: string };
type DirNode = { kind: 'tree'; entries: Record<string, FileNode | DirNode> };

function run(repoDir: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile('git', args, { cwd: repoDir, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolvePromise(stdout.toString().trim());
    });
    if (input !== undefined) child.stdin!.end(input);
    else child.stdin!.end();
  });
}

async function hashBlob(repoDir: string, content: string): Promise<string> {
  return run(repoDir, ['hash-object', '-w', '--stdin'], content);
}

async function buildTree(repoDir: string, entries: Record<string, FileNode | DirNode>): Promise<string> {
  const lines: string[] = [];
  for (const [name, node] of Object.entries(entries)) {
    if (node.kind === 'blob') {
      lines.push(`100644 blob ${node.sha}\t${name}`);
    } else {
      const sha = await buildTree(repoDir, node.entries);
      lines.push(`040000 tree ${sha}\t${name}`);
    }
  }
  return run(repoDir, ['mktree'], lines.join('\n') + '\n');
}

async function commitTree(repoDir: string, treeSha: string, message: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['commit-tree', treeSha, '-m', message],
      {
        cwd: repoDir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.com',
          GIT_COMMITTER_NAME: 'fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.com',
        },
      },
      (err, stdout) => {
        if (err) reject(err);
        else resolvePromise(stdout.toString().trim());
      },
    );
  });
}

async function buildSessionNode(repoDir: string, session: FixtureSession): Promise<DirNode> {
  const metadata = {
    session_id: session.sessionId,
    created_at: session.createdAt,
    agent: 'claude-code',
    model: 'claude-sonnet-4.6',
    branch: 'main',
    files_touched: [],
    token_usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ...(session.headless ? {} : { session_metrics: { turn_count: session.turnCount ?? session.lines.length } }),
  };
  const transcript = session.lines.map((l) => JSON.stringify(l)).join('\n');
  const [metaSha, promptSha, transcriptSha, fullSha] = await Promise.all([
    hashBlob(repoDir, JSON.stringify(metadata, null, 2)),
    hashBlob(repoDir, ''),
    hashBlob(repoDir, transcript),
    hashBlob(repoDir, transcript),
  ]);
  return {
    kind: 'tree',
    entries: {
      'metadata.json': { kind: 'blob', sha: metaSha },
      'prompt.txt': { kind: 'blob', sha: promptSha },
      'transcript.jsonl': { kind: 'blob', sha: transcriptSha },
      'full.jsonl': { kind: 'blob', sha: fullSha },
    },
  };
}

async function buildCheckpointNode(repoDir: string, checkpoint: FixtureCheckpoint): Promise<DirNode> {
  const rootMetadata = {
    checkpoint_id: checkpoint.id,
    branch: 'main',
    sessions: checkpoint.sessions.map((s) => s.sessionId),
    token_usage: {},
  };
  const metaSha = await hashBlob(repoDir, JSON.stringify(rootMetadata, null, 2));
  const entries: Record<string, FileNode | DirNode> = { 'metadata.json': { kind: 'blob', sha: metaSha } };
  for (let n = 0; n < checkpoint.sessions.length; n += 1) {
    entries[String(n)] = await buildSessionNode(repoDir, checkpoint.sessions[n]!);
  }
  return { kind: 'tree', entries };
}

/** Builds a temp git repo with one trailer-linked commit per checkpoint and checkpoint trees in the given layout. */
export async function makeRepo(spec: FixtureSpec): Promise<string> {
  const repoDir = await mkdtemp(join(tmpdir(), 'dailies-ingest-'));
  await run(repoDir, ['init', '-q', '-b', 'main']);
  await run(repoDir, ['config', 'user.name', 'fixture']);
  await run(repoDir, ['config', 'user.email', 'fixture@example.com']);

  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  await run(repoDir, ['add', 'README.md']);
  await run(repoDir, ['commit', '-q', '-m', 'init']);

  const branchNodes: { id: string; node: DirNode }[] = [];

  for (const checkpoint of spec.checkpoints) {
    await writeFile(join(repoDir, `${checkpoint.id}.txt`), checkpoint.id);
    await run(repoDir, ['add', `${checkpoint.id}.txt`]);
    await run(repoDir, ['commit', '-q', '-m', `work for ${checkpoint.id}\n\nEntire-Checkpoint: ${checkpoint.id}`]);

    const node = await buildCheckpointNode(repoDir, checkpoint);

    if (spec.layout === 'refs') {
      const treeSha = await buildTree(repoDir, node.entries);
      const commitSha = await commitTree(repoDir, treeSha, `checkpoint ${checkpoint.id}`);
      const shard = checkpoint.id.slice(0, 2);
      await run(repoDir, ['update-ref', `refs/entire/checkpoints/${shard}/${checkpoint.id}`, commitSha]);
    } else {
      branchNodes.push({ id: checkpoint.id, node });
    }
  }

  if (spec.layout === 'branch' && branchNodes.length > 0) {
    const rootEntries: Record<string, DirNode> = {};
    for (const { id, node } of branchNodes) {
      const shard = id.slice(0, 2);
      const rest = id.slice(2);
      const shardNode = (rootEntries[shard] ??= { kind: 'tree', entries: {} });
      shardNode.entries[rest] = node;
    }
    const treeSha = await buildTree(repoDir, rootEntries);
    const commitSha = await commitTree(repoDir, treeSha, 'checkpoints branch');
    await run(repoDir, ['update-ref', 'refs/heads/entire/checkpoints/v1', commitSha]);
  }

  return repoDir;
}
