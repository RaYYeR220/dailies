import { resolve } from 'node:path';
import { z } from 'zod';
import { defineTool, runAgent, type Tool } from '@dailies/agent';
import { Beat, type Entry, type IngestArtifact, type Session } from '@dailies/core';
import { editorPrompt } from '../prompts/editor';
import type { Stage } from '../types';
import type { StageDeps } from './index';

export interface EditArtifact { beats: Beat[] }

const MAX_BEATS = 6;
const MAX_ENTRIES_PER_READ = 40;
const ENTRY_TEXT_CHARS = 600;
const FIRST_PROMPT_CHARS = 200;
const MAX_MATCHES = 20;
const SNIPPET_CHARS = 200;
const MIN_SHA_PREFIX = 7;
const COMMAND_CHARS = 600;
const PATH_CHARS = 300;
const NAME_CHARS = 80;
const MAX_LISTED_COMMITS = 40;
const LABEL_CHARS = 80;

/** `text` in at most `max` characters; a cut is marked with an ellipsis that counts towards the limit. */
export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** `text` as one line of at most `max` characters: line breaks and control characters become single spaces. */
export function oneLine(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return cut(text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029\s]+/g, ' ').trim(), max);
}

/** Added and removed line counts of one file's patch, headers excluded. */
export function patchCounts(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

/**
 * `owner/name` for a remote URL, the directory name for a local path. It goes into prompts and onto the title
 * card, so it is built from path segments only (a URL's credentials never reach it), kept to one short line,
 * and never falls back to the raw input.
 */
export function repoLabel(repoUrl: string): string {
  const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(repoUrl);   // git@host:owner/name
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(repoUrl);
  const remote = scp !== null || url;
  const path = scp ? scp[1]! : url ? urlPath(repoUrl) : resolve(repoUrl);
  // eslint-disable-next-line no-control-regex
  const segments = path.replace(/[\u0000-\u001f\u007f]+/g, ' ').split('/').map((part) => part.trim()).filter(Boolean);
  const label = segments.slice(remote ? -2 : -1).join('/').replace(/\.git$/, '');
  return cut(label, LABEL_CHARS) || 'repository';
}

function urlPath(url: string): string {
  try {
    const { pathname } = new URL(url);
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  } catch {
    return '';
  }
}

/** Every commit the artifact knows: the ones linked to a session and the ones it holds a patch for. */
export function knownCommits(ingest: IngestArtifact): string[] {
  const shas = new Set(ingest.sessions.flatMap((s) => s.commits));
  for (const key of Object.keys(ingest.diffs)) shas.add(key.slice(0, key.indexOf(':')));
  return [...shas];
}

/** The full hash `sha` stands for: itself when known, or the one known commit it is a prefix of. */
export function resolveCommit(sha: string, known: string[]): string | null {
  if (known.includes(sha)) return sha;
  if (sha.length < MIN_SHA_PREFIX) return null;
  const matches = known.filter((k) => k.startsWith(sha));
  return matches.length === 1 ? matches[0]! : null;
}

const cutOptional = (text: string | undefined, max: number) => (text === undefined ? undefined : cut(text, max));

// Ingest bounds an entry's text but not its command, file path or tool name, so every string is cut here.
function entryView(e: Entry) {
  return {
    id: e.id,
    index: e.index,
    kind: e.kind,
    text: cut(e.text, ENTRY_TEXT_CHARS),
    toolName: cutOptional(e.toolName, NAME_CHARS),
    command: cutOptional(e.command, COMMAND_CHARS),
    filePath: cutOptional(e.filePath, PATH_CHARS),
    isError: e.isError,
  };
}

/** The editor's read-only view of the ingest artifact. Every result is bounded, whatever the transcript holds. */
export function transcriptTools(ingest: IngestArtifact): Tool[] {
  const sessions = new Map(ingest.sessions.map((s) => [s.id, s]));
  const commits = knownCommits(ingest);
  const sessionOf = (id: string): Session => {
    const found = sessions.get(id);
    if (!found) throw new Error(`unknown session: ${id}`);
    return found;
  };
  const commitOf = (sha: string): string => {
    const found = resolveCommit(sha, commits);
    if (!found) throw new Error(`unknown commit: ${sha}`);
    return found;
  };

  return [
    defineTool({
      name: 'list_sessions',
      description: 'List every recorded session in the window: id, agent, model, start, end, entry count, linked commits and the first human prompt.',
      parameters: z.object({}),
      execute: async () =>
        ingest.sessions.map((s) => ({
          id: s.id,
          agent: cut(s.agent, NAME_CHARS),
          model: s.model === null ? null : cut(s.model, NAME_CHARS),
          start: s.startedAt,
          end: s.endedAt,
          entryCount: s.entries.length,
          commits: s.commits.slice(0, MAX_LISTED_COMMITS),
          firstPrompt: cut(s.entries.find((e) => e.kind === 'user')?.text ?? '', FIRST_PROMPT_CHARS),
        })),
    }),
    defineTool({
      name: 'read_entries',
      description: `Read the entries of a session from index "from" to index "to", both included. Returns at most ${MAX_ENTRIES_PER_READ} entries per call; "next" is the index to continue from, or null.`,
      parameters: z.object({ sessionId: z.string(), from: z.number().int(), to: z.number().int() }),
      execute: async ({ sessionId, from, to }) => {
        const session = sessionOf(sessionId);
        const start = Math.max(0, from);
        const end = Math.min(to, session.entries.length - 1);
        const entries = session.entries.slice(start, end + 1).slice(0, MAX_ENTRIES_PER_READ);
        const next = start + entries.length;
        return { entries: entries.map(entryView), entryCount: session.entries.length, next: next <= end ? next : null };
      },
    }),
    defineTool({
      name: 'search_transcript',
      description: `Find entries whose text or command contains the query, ignoring case, across every session. Returns up to ${MAX_MATCHES} matches with their entry ids.`,
      parameters: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        const needle = query.toLowerCase();
        const matches: { id: string; sessionId: string; index: number; kind: Entry['kind']; snippet: string }[] = [];
        let more = false;
        for (const entry of ingest.sessions.flatMap((s) => s.entries)) {
          const haystack = `${entry.command ?? ''}\n${entry.text}`;
          const at = haystack.toLowerCase().indexOf(needle);
          if (at === -1) continue;
          if (matches.length === MAX_MATCHES) {
            more = true;
            break;
          }
          const from = Math.max(0, at - SNIPPET_CHARS / 2);
          matches.push({ id: entry.id, sessionId: entry.sessionId, index: entry.index, kind: entry.kind, snippet: haystack.slice(from, from + SNIPPET_CHARS).trim() });
        }
        return { matches, more };
      },
    }),
    defineTool({
      name: 'get_diff',
      description: 'List the files a commit changed, with added and removed line counts.',
      parameters: z.object({ sha: z.string() }),
      execute: async ({ sha }) => {
        const prefix = `${commitOf(sha)}:`;
        const files = Object.entries(ingest.diffs)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, patch]) => ({ path: key.slice(prefix.length), ...patchCounts(patch) }));
        return { files };
      },
    }),
    defineTool({
      name: 'get_patch',
      description: 'Read the patch of one file in one commit.',
      parameters: z.object({ sha: z.string(), path: z.string() }),
      execute: async ({ sha, path }) => {
        const patch = ingest.diffs[`${commitOf(sha)}:${path}`];
        if (patch === undefined) throw new Error(`no patch for ${path} in ${sha}`);
        return { patch };
      },
    }),
  ];
}

// The id is ours to assign, and a beat with no commits is still a beat.
const BeatDraft = Beat.omit({ id: true }).extend({ commits: z.array(z.string()).default([]) });
const EditorReply = z.object({ beats: z.array(BeatDraft) });

/** Why a beat cannot be used, or null when every session and range it names exists. */
function beatProblem(beat: z.infer<typeof BeatDraft>, sessions: Map<string, Session>): string | null {
  for (const id of beat.sessionIds) if (!sessions.has(id)) return `unknown session ${id}`;
  for (const range of beat.entryRanges) {
    const session = sessions.get(range.sessionId);
    if (!session) return `unknown session ${range.sessionId}`;
    if (range.from < 0 || range.to < range.from || range.to >= session.entries.length) {
      return `range ${range.from}..${range.to} is outside session ${range.sessionId} (${session.entries.length} entries)`;
    }
  }
  return null;
}

export function editStage(deps: StageDeps): Stage<EditArtifact> {
  return {
    name: 'edit',
    maxAttempts: 3,
    async run(ctx) {
      const ingest = ctx.read<IngestArtifact>('ingest');
      const sessions = new Map(ingest.sessions.map((s) => [s.id, s]));
      const commits = knownCommits(ingest);

      const { system, user } = editorPrompt({
        repo: repoLabel(ctx.run.repoUrl),
        since: ctx.run.since,
        until: ctx.run.until,
        sessionCount: ingest.sessions.length,
        maxBeats: MAX_BEATS,
      });
      const { output, steps } = await runAgent({ client: deps.client, role: 'editor', name: 'editor', system, user, tools: transcriptTools(ingest), output: EditorReply });

      const usable: z.infer<typeof BeatDraft>[] = [];
      for (const draft of output.beats) {
        const problem = beatProblem(draft, sessions);
        if (problem) ctx.log(`dropped beat "${draft.title}": ${problem}`);
        else usable.push(draft);
      }
      if (usable.length === 0) throw new Error('the editor returned no usable beat');
      if (usable.length > MAX_BEATS) ctx.log(`kept the first ${MAX_BEATS} of ${usable.length} beats`);

      const beats: Beat[] = usable.slice(0, MAX_BEATS).map((draft, n) => ({
        ...draft,
        id: `beat_${n + 1}`,
        commits: [...new Set(draft.commits.flatMap((sha) => resolveCommit(sha, commits) ?? []))],
      }));
      ctx.log(`${beats.length} beats in ${steps} editor steps`);
      return { artifact: { beats } };
    },
  };
}
