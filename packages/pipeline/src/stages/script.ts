import { z } from 'zod';
import { completeJson } from '@dailies/agent';
import { computeFacts, EvidenceRef, Storyboard, type Beat, type Claim, type Entry, type Facts, type IngestArtifact, type Line, type Scene, type Session } from '@dailies/core';
import { collectRuns, headlineFor, type ToolRun } from '@dailies/verify';
import { writerPrompt, type WriterMaterial } from '../prompts/writer';
import type { Stage } from '../types';
import { cut, historyNote, knownCommits, patchCounts, repoLabel, resolveCommit, type EditArtifact } from './edit';
import type { StageDeps } from './index';
import type { VerifyArtifact } from './verify';

export interface ScriptArtifact { storyboard: Storyboard; discarded: string[] }

type SceneOf<T extends Scene['type']> = Extract<Scene, { type: T }>;
type Step = SceneOf<'terminal'>['steps'][number];
type FlaggedClaim = Claim & { verdict: 'contradicted' | 'stale' };

const TARGET_SEC = 75;
const MAX_FLAGS = 3;
const SPOKEN_QUOTE_CHARS = 120;
const MAX_LINES_TOTAL = 11;
const MAX_WORDS_PER_LINE = 18;
const MAX_TERMINAL_SCENES = 2;
const MAX_DIFF_SCENES = 2;
// What the scene schema allows on screen.
const ON_SCREEN = { promptQuote: 280, command: 200, output: 600, hunk: 2400, steps: 4, statValue: 16, flagQuote: 240, flagReality: 200 };
// What the writer is shown of each beat.
const MATERIAL = { entries: 24, entriesFromStart: 8, entryChars: 400, patches: 3, patchChars: 1500, claims: 12, quoteChars: 200, feedbackChars: 2000 };

const STATS: [key: string, label: string][] = [
  ['sessions.count', 'Sessions'],
  ['commits.count', 'Commits'],
  ['files.count', 'Files touched'],
  ['turns.total', 'Turns'],
  ['tools.calls', 'Tool calls'],
  ['duration.minutes', 'Minutes'],
];

const NO_OUTPUT = /^\s*\(Bash completed with no output\)\s*$/;
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const endsSentence = (text: string) => /[.!?]$/.test(text);

/** `cut`, ending on a whole word where there is one to end on. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The last `max` characters, starting on a line where one starts early enough: a run's summary is at its end. */
function tail(text: string, max: number): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= max) return trimmed;
  const end = trimmed.slice(trimmed.length - (max - 1));
  const lineStart = end.indexOf('\n') + 1;
  return `…${lineStart > 0 && lineStart < end.length / 2 ? end.slice(lineStart) : end}`;
}

function day(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? cut(flat(iso), 24) : new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The window the way a person would say it, in UTC: `11 Oct, 23:05 – 12 Oct, 02:25`, or `11 Oct, 14:00 – 18:30`
 * within one date. It runs from the first session's start to the last session's end, which is when the work
 * happened; the dates the run was asked for only bound it. A session with no recorded end ends where it started.
 * When no session carries a time that can be read, the label is the two dates of the run.
 */
function windowLabelOf(sessions: Session[], run: { since: string; until: string }): string {
  const starts = sessions.map((s) => Date.parse(s.startedAt)).filter((ms) => !Number.isNaN(ms));
  const ends = sessions.map((s) => Date.parse(s.endedAt ?? s.startedAt)).filter((ms) => !Number.isNaN(ms));
  if (starts.length === 0 || ends.length === 0) return [...new Set([day(run.since), day(run.until)])].join(' – ');
  const two = (n: number) => String(n).padStart(2, '0');
  const said = (ms: number) => {
    const at = new Date(ms);
    return { date: `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`, time: `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}` };
  };
  const [first, last] = [Math.min(...starts), Math.max(...ends, ...starts)];
  const [from, to] = [said(first), said(last)];
  if (Math.floor(first / DAY_MS) !== Math.floor(last / DAY_MS)) return `${from.date}, ${from.time} – ${to.date}, ${to.time}`;
  return from.time === to.time ? `${from.date}, ${from.time}` : `${from.date}, ${from.time} – ${to.time}`;
}

function realityOf(claim: FlaggedClaim): string {
  if (claim.verdict === 'stale') return 'Code was edited after the last passing run.';
  if (claim.kind === 'tests_pass') return 'The last test run before that message reported failures.';
  const reason = flat(claim.reason ?? '') || 'the record contradicts this claim';
  return cut(`${reason[0]!.toUpperCase()}${reason.slice(1)}${endsSentence(reason) ? '' : '.'}`, ON_SCREEN.flagReality);
}

/**
 * The flag scene for a claim a rule found contradicted or stale. Every word of it is the agent's own quote,
 * a fixed sentence, or the rule's reason: no model writes any part of a flag.
 */
export function flagScene(claim: FlaggedClaim): SceneOf<'flag'> {
  const quote = flat(claim.quote);
  const spoken = cutAtWord(quote, SPOKEN_QUOTE_CHARS);
  const reality = realityOf(claim);
  return {
    id: `flag_${claim.id}`,
    type: 'flag',
    claimId: claim.id,
    verdict: claim.verdict,
    quote: cut(quote, ON_SCREEN.flagQuote),
    reality,
    lines: [
      // What the agent wrote rests on the entry that holds the words; what the record shows rests on what the rule found.
      { id: `flag_${claim.id}_quote`, text: `The agent wrote: "${spoken}"${endsSentence(spoken) ? '' : '.'}`, evidence: [{ type: 'entry', entryId: claim.entryId, quote: claim.quote }] },
      { id: `flag_${claim.id}_reality`, text: reality, evidence: claim.evidence },
    ],
  };
}

const isFlagged = (claim: Claim): claim is FlaggedClaim => (claim.verdict === 'contradicted' || claim.verdict === 'stale') && claim.evidence.length > 0;

// The writer points and narrates; it supplies none of what a scene shows. Keys other than these are ignored.
const WriterReply = z.object({ scenes: z.array(z.unknown()) });
const WriterLine = z.object({ text: z.string().trim().min(1).max(220), evidence: z.array(EvidenceRef).min(1) });
const rawLines = z.array(z.unknown());
const WriterScene = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt'), entryId: z.string(), lines: rawLines }),
  z.object({ type: z.literal('terminal'), steps: z.array(z.object({ entryId: z.string() })).min(1), lines: rawLines }),
  z.object({ type: z.literal('diff'), sha: z.string(), path: z.string(), lines: rawLines }),
  z.object({ type: z.literal('stats'), lines: rawLines }),
]);
type WriterScene = z.infer<typeof WriterScene>;

function typeName(raw: unknown): string {
  const type = typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined;
  return typeof type === 'string' ? cut(flat(type), 20) : 'untyped';
}

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The hard limits the writer is told about but code enforces regardless: a line over the word
 * limit is dropped outright; a terminal or diff scene past the per-type cap is dropped whole,
 * earliest kept; the remaining lines are then capped at the total, dropped from the end across
 * the whole sequence. A scene left with no lines is removed.
 */
function applyHardLimits(scenes: Scene[], discarded: string[]): Scene[] {
  const byWordLimit = scenes.flatMap((scene) => {
    const lines = scene.lines.filter((line) => {
      const words = wordCount(line.text);
      if (words <= MAX_WORDS_PER_LINE) return true;
      discarded.push(`${scene.id}: a line of ${words} words is over the ${MAX_WORDS_PER_LINE}-word limit`);
      return false;
    });
    if (lines.length === 0) {
      discarded.push(`${scene.id}: left with no lines after the ${MAX_WORDS_PER_LINE}-word limit`);
      return [];
    }
    return lines.length === scene.lines.length ? [scene] : [{ ...scene, lines } as Scene];
  });

  let terminalSeen = 0;
  let diffSeen = 0;
  const byTypeCap = byWordLimit.filter((scene) => {
    if (scene.type === 'terminal' && (terminalSeen += 1) > MAX_TERMINAL_SCENES) {
      discarded.push(`${scene.id}: over the ${MAX_TERMINAL_SCENES}-terminal-scene limit`);
      return false;
    }
    if (scene.type === 'diff' && (diffSeen += 1) > MAX_DIFF_SCENES) {
      discarded.push(`${scene.id}: over the ${MAX_DIFF_SCENES}-diff-scene limit`);
      return false;
    }
    return true;
  });

  let total = 0;
  const capped: Scene[] = [];
  for (const scene of byTypeCap) {
    if (total >= MAX_LINES_TOTAL) {
      discarded.push(`${scene.id}: dropped past the ${MAX_LINES_TOTAL}-line total`);
      continue;
    }
    const room = MAX_LINES_TOTAL - total;
    const lines = scene.lines.length <= room ? scene.lines : scene.lines.slice(0, room);
    if (lines.length < scene.lines.length) discarded.push(`${scene.id}: ${scene.lines.length - lines.length} line(s) dropped past the ${MAX_LINES_TOTAL}-line total`);
    total += lines.length;
    if (lines.length > 0) capped.push(lines.length === scene.lines.length ? scene : ({ ...scene, lines } as Scene));
  }
  return capped;
}

export function scriptStage(deps: StageDeps): Stage<ScriptArtifact> {
  return {
    name: 'script',
    maxAttempts: 3,
    async run(ctx) {
      const ingest = ctx.read<IngestArtifact>('ingest');
      const { beats, memory } = ctx.read<EditArtifact>('edit');
      const verify = ctx.read<VerifyArtifact>('verify');

      const sessions = new Map(ingest.sessions.map((s) => [s.id, s]));
      const entries = new Map(ingest.sessions.flatMap((s) => s.entries.map((e) => [e.id, e] as const)));
      const commits = knownCommits(ingest);
      const facts = computeFacts(ingest.sessions);
      const repo = repoLabel(ctx.run.repoUrl);
      const windowLabel = windowLabelOf(ingest.sessions, ctx.run);

      const runs = new Map<string, ToolRun[]>();
      const runsOf = (session: Session): ToolRun[] => {
        if (!runs.has(session.id)) runs.set(session.id, collectRuns(session));
        return runs.get(session.id)!;
      };

      // Newest first: the later session, then the later entry.
      const startOf = (claim: Claim) => Date.parse(sessions.get(claim.sessionId)?.startedAt ?? '') || 0;
      const indexOf = (claim: Claim) => entries.get(claim.entryId)?.index ?? -1;
      const flagged = verify.claims
        .filter(isFlagged)
        .sort((a, b) => startOf(b) - startOf(a) || indexOf(b) - indexOf(a))
        .slice(0, MAX_FLAGS);

      /** A shell call the record holds a readable result for, as a terminal step; null when there is nothing to show. */
      const stepFor = (entryId: string): Step | null => {
        const entry = entries.get(entryId);
        const session = entry && sessions.get(entry.sessionId);
        if (!entry || !session || entry.toolUseId === undefined) return null;
        const call = entry.kind === 'tool_call' ? entry : session.entries.find((e) => e.kind === 'tool_call' && e.toolUseId === entry.toolUseId);
        if (!call || call.command === undefined) return null;
        const result = session.entries.find((e) => e.kind === 'tool_result' && e.toolUseId === call.toolUseId);
        if (!result) return null;
        // A test, build, type-check or lint run gets its mark from the parsed output. One the parser cannot read gets no mark at all.
        const run = runsOf(session).find((r) => r.callEntryId === call.id);
        if (run?.outcome === 'unknown') return null;
        const ok = run ? run.outcome === 'pass' : !(result.isError ?? false);
        const headline = run ? headlineFor(run.cls, result.text) ?? undefined : undefined;
        // What Claude Code records for a command that printed nothing is a note, not output: on screen the step just reads as its verdict.
        const printed = NO_OUTPUT.test(result.text) ? '' : result.text;
        return { command: cut(flat(call.command), ON_SCREEN.command), output: tail(printed, ON_SCREEN.output), ok, entryId: call.id, headline };
      };

      /** The scene the writer pointed at, filled from the record; or the reason there is nothing there to show. */
      const frame = (scene: WriterScene, id: string, lines: Line[]): Scene | string => {
        if (scene.type === 'prompt') {
          const entry = entries.get(scene.entryId);
          if (!entry || entry.kind !== 'user' || flat(entry.text) === '') return `${scene.entryId} is not a human prompt`;
          return { id, type: 'prompt', lines, quote: cut(flat(entry.text), ON_SCREEN.promptQuote), sessionId: entry.sessionId, entryId: entry.id };
        }
        if (scene.type === 'terminal') {
          const steps = scene.steps.flatMap((s) => stepFor(s.entryId) ?? []).slice(0, ON_SCREEN.steps);
          if (steps.length === 0) return 'no step points at a command with a readable result';
          return { id, type: 'terminal', lines, steps };
        }
        if (scene.type === 'diff') {
          const sha = resolveCommit(scene.sha, commits);
          const patch = sha === null ? undefined : ingest.diffs[`${sha}:${scene.path}`];
          const hunkAt = patch?.search(/^@@/m) ?? -1;
          if (sha === null || patch === undefined || hunkAt === -1) return 'no patch for that commit and path';
          return { id, type: 'diff', lines, sha, path: scene.path, hunk: cut(patch.slice(hunkAt), ON_SCREEN.hunk), ...patchCounts(patch) };
        }
        const items = STATS.filter(([key]) => Object.hasOwn(facts, key) && Number(facts[key]) > 0).map(([key, label]) => ({
          label,
          value: cut(String(facts[key]), ON_SCREEN.statValue),
          statKey: key,
        }));
        return { id, type: 'stats', lines, items };
      };

      const { system, user } = writerPrompt({
        repo,
        window: windowLabel,
        targetSec: TARGET_SEC,
        facts,
        beats: beats.map((beat) => beatMaterial(beat, ingest, sessions)),
        verified: verify.claims
          .filter((c) => c.verdict === 'verified')
          .slice(0, MATERIAL.claims)
          .map((c) => ({ kind: c.kind, quote: cut(flat(c.quote), MATERIAL.quoteChars), entryId: c.entryId })),
        flagged: flagged.map((c) => ({ quote: cut(flat(c.quote), MATERIAL.quoteChars), sessionId: c.sessionId })),
        feedback: ctx.feedback === null ? null : cut(ctx.feedback, MATERIAL.feedbackChars),
      });
      const userWithHistory = `${user}${historyNote(memory)}`;
      const reply = await completeJson({ client: deps.client, role: 'writer', name: 'writer', system, user: userWithHistory, output: WriterReply });

      const discarded: string[] = [];
      const written: Scene[] = [];
      let lineCount = 0;
      reply.scenes.forEach((raw, n) => {
        const where = `scene ${n + 1} (${typeName(raw)})`;
        const parsed = WriterScene.safeParse(raw);
        if (!parsed.success) return void discarded.push(`${where}: not a scene the writer may produce`);
        if (parsed.data.type === 'stats' && written.some((s) => s.type === 'stats')) return void discarded.push(`${where}: the reel closes on one stats scene`);

        const kept = parsed.data.lines.flatMap((rawLine, k) => {
          const line = WriterLine.safeParse(rawLine);
          if (!line.success) discarded.push(`${where} line ${k + 1}: no text or no evidence`);
          return line.success ? [line.data] : [];
        });
        if (kept.length === 0) return void discarded.push(`${where}: no line with evidence`);

        const scene = frame(parsed.data, `sc_${written.length + 1}`, kept.map((line) => ({ id: `l${(lineCount += 1)}`, ...line })));
        if (typeof scene === 'string') return void discarded.push(`${where}: ${scene}`);
        written.push(scene);
      });
      if (written.length === 0) throw new Error(`the writer returned no usable scene (${discarded.length} discarded)`);

      const limited = applyHardLimits(written, discarded);
      if (limited.length === 0) throw new Error(`the writer returned no usable scene (${discarded.length} discarded)`);

      // The arc closes on the stats scene. A flag follows the last validation scene of its session, or precedes the stats.
      const body = [...limited.filter((s) => s.type !== 'stats'), ...limited.filter((s) => s.type === 'stats')];
      const validations = body.filter((s) => s.type === 'terminal').reverse();
      const flags = flagged.map((claim) => ({
        scene: flagScene(claim),
        anchor: validations.find((s) => s.steps.some((step) => entries.get(step.entryId)?.sessionId === claim.sessionId))?.id,
      }));
      const loose = flags.filter((f) => f.anchor === undefined).map((f) => f.scene);
      const scenes: Scene[] = [{ id: 'title', type: 'title', lines: [], repo, windowLabel, sessionCount: ingest.sessions.length, commitCount: Number(facts['commits.count']) }];
      for (const scene of body) {
        if (scene.type === 'stats') scenes.push(...loose.splice(0));
        scenes.push(scene, ...flags.filter((f) => f.anchor === scene.id).map((f) => f.scene));
      }
      scenes.push(...loose, { id: 'end', type: 'end', lines: [], repo, verified: verify.counts.verified, flagged: verify.counts.contradicted + verify.counts.stale, unverified: verify.counts.unverifiable });

      const storyboard = Storyboard.parse({ runId: ctx.run.id, repo, targetSec: TARGET_SEC, facts, scenes });
      ctx.log(`${limited.length} written scenes, ${flags.length} flag scenes, ${discarded.length} pieces of writer output discarded`);
      return { artifact: { storyboard, discarded } };
    },
  };
}

/** What the writer sees of one beat: the prompts, the agent's messages and the shell runs in its ranges, and its patches. */
function beatMaterial(beat: Beat, ingest: IngestArtifact, sessions: Map<string, Session>): WriterMaterial['beats'][number] {
  const inRanges = beat.entryRanges.flatMap((range) => {
    const session = sessions.get(range.sessionId);
    if (!session) return [];
    const shell = new Set(session.entries.filter((e) => e.kind === 'tool_call' && e.command !== undefined).map((e) => e.toolUseId));
    return session.entries
      .slice(Math.max(0, range.from), range.to + 1)
      .filter((e) => e.kind === 'user' || e.kind === 'assistant' || (e.toolUseId !== undefined && shell.has(e.toolUseId)));
  });
  const shown = inRanges.length <= MATERIAL.entries ? inRanges : [...inRanges.slice(0, MATERIAL.entriesFromStart), ...inRanges.slice(MATERIAL.entriesFromStart - MATERIAL.entries)];

  const view = (e: Entry) => ({
    id: e.id,
    kind: e.kind,
    text: e.kind === 'tool_result' ? tail(e.text, MATERIAL.entryChars) : cut(e.text, MATERIAL.entryChars),
    command: e.kind === 'tool_call' && e.command !== undefined ? cut(flat(e.command), ON_SCREEN.command) : undefined,
    errored: e.kind === 'tool_result' ? (e.isError ?? false) : undefined,
  });
  const patches = beat.commits
    .flatMap((sha) => Object.entries(ingest.diffs).filter(([key]) => key.startsWith(`${sha}:`)).map(([key, patch]) => ({ sha, path: key.slice(sha.length + 1), patch })))
    .slice(0, MATERIAL.patches)
    .map((p) => ({ sha: p.sha, path: p.path, ...patchCounts(p.patch), patch: cut(p.patch, MATERIAL.patchChars) }));

  return { kind: beat.kind, title: beat.title, summary: beat.summary, entries: shown.map(view), patches };
}
