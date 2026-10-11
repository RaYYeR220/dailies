import { collectRuns } from '@dailies/verify';
import type { Beat, Session } from '@dailies/core';

const PROMPT_CHARS = 240;
const MESSAGE_CHARS = 240;
const MAX_COMMITS = 6;
const MAX_FILES = 8;
const MAX_RUNS = 12;
const BEAT_TITLE_CHARS = 80;
const BEAT_SUMMARY_CHARS = 400;
const ID_CHARS = 80;
const NAME_CHARS = 80;
const DATE_CHARS = 40;
const COMMIT_CHARS = 40;
const FILE_PATH_CHARS = 300;

/** `text` in at most `max` characters; a cut is marked with an ellipsis that counts towards the limit. */
export function cut(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** `text` as one line of at most `max` characters: line breaks and control characters become single spaces. */
export function oneLine(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return cut(text.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029\s]+/g, ' ').trim(), max);
}

export interface SessionOutline {
  id: string;
  agent: string;
  model: string | null;
  startedAt: string;
  minutes: number;
  turns: number;
  entries: number;
  firstPrompt: string; // first user entry, at most 240 characters
  lastMessage: string; // last assistant entry, at most 240 characters
  commits: string[]; // short SHAs, at most 6
  files: string[]; // at most 8
  runs: string[]; // e.g. "test fail @120", "test pass @188", at most 12, in order
  edits: number; // file-editing tool calls
}

function minutesBetween(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

/** One line per recorded command: its kind, outcome and entry index, in session order. */
function runLines(session: Session, max: number): string[] {
  return collectRuns(session)
    .slice(0, max)
    .map((r) => `${r.cls} ${r.outcome} @${r.index}`);
}

/** A compact summary of one session: enough for the editor to choose beats without reading the transcript. */
export function outlineSession(session: Session): SessionOutline {
  const firstPrompt = session.entries.find((e) => e.kind === 'user')?.text ?? '';
  const lastAssistant = [...session.entries].reverse().find((e) => e.kind === 'assistant' && e.text.trim() !== '');
  const edits = session.entries.filter((e) => e.kind === 'tool_call' && e.filePath !== undefined).length;
  return {
    id: oneLine(session.id, ID_CHARS),
    agent: oneLine(session.agent, NAME_CHARS),
    model: session.model === null ? null : oneLine(session.model, NAME_CHARS),
    startedAt: oneLine(session.startedAt, DATE_CHARS),
    minutes: minutesBetween(session.startedAt, session.endedAt),
    turns: session.turnCount,
    entries: session.entries.length,
    firstPrompt: oneLine(firstPrompt, PROMPT_CHARS),
    lastMessage: oneLine(lastAssistant?.text ?? '', MESSAGE_CHARS),
    commits: session.commits.slice(0, MAX_COMMITS).map((c) => oneLine(c, COMMIT_CHARS)),
    files: session.filesTouched.slice(0, MAX_FILES).map((f) => oneLine(f, FILE_PATH_CHARS)),
    runs: runLines(session, MAX_RUNS),
    edits,
  };
}

function trimmedTo(outline: SessionOutline, cap: number): SessionOutline {
  return { ...outline, firstPrompt: cut(outline.firstPrompt, cap), lastMessage: cut(outline.lastMessage, cap) };
}

/**
 * Every session's outline, `firstPrompt` and `lastMessage` trimmed evenly, as far as needed, so the
 * JSON fits `maxChars`. No session is ever dropped: every other field is already bounded in
 * `outlineSession`, so for a realistic session count the fixed cost of those fields plus fully
 * trimmed text still fits; an unrealistic number of sessions can still exceed `maxChars` even at
 * cap zero, which is accepted here rather than dropping a session to force the fit.
 */
export function outlinesWithin(sessions: Session[], maxChars: number): SessionOutline[] {
  const full = sessions.map(outlineSession);
  const fits = (cap: number) => JSON.stringify(full.map((o) => trimmedTo(o, cap))).length <= maxChars;
  if (fits(PROMPT_CHARS)) return full;

  let lo = 0;
  let hi = PROMPT_CHARS;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return full.map((o) => trimmedTo(o, lo));
}

/**
 * The newest sessions with commits first, as whole-session beats, for when the editor could not
 * produce any. The title and summary are synthetic, not drawn from the session's own recorded
 * text: a beat built here skips the editor entirely, and its title/summary go straight into the
 * writer's prompt as trusted framing (script.ts's beatMaterial), so nothing the session recorded
 * — a prompt included — belongs in them unmediated.
 */
export function fallbackBeats(sessions: Session[], max: number): Beat[] {
  const sorted = [...sessions].sort((a, b) => {
    const byCommit = (a.commits.length > 0 ? 0 : 1) - (b.commits.length > 0 ? 0 : 1);
    return byCommit !== 0 ? byCommit : b.startedAt.localeCompare(a.startedAt);
  });
  return sorted.slice(0, max).map((s, n) => ({
    id: `beat_${n + 1}`,
    kind: 'feature' as const,
    title: oneLine(`Session ${s.id}`, BEAT_TITLE_CHARS),
    summary: oneLine(`Automatic fallback beat covering the recorded session ${s.id} end to end.`, BEAT_SUMMARY_CHARS),
    sessionIds: [s.id],
    entryRanges: [{ sessionId: s.id, from: 0, to: Math.max(0, s.entries.length - 1) }],
    commits: s.commits,
  }));
}
