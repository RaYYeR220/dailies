import type { Claim, EvidenceRef, LineTiming, Scene, Storyboard } from '@dailies/core';
import { sentence } from './format';
import { markFor, type Mark, type Verdict } from './model';

/**
 * Where the narration starts in the video: the title card plays first. The web app may not import the
 * renderer, so this repeats TITLE_SEC from packages/reel/src/timeline.ts; END_SEC and TAIL_SEC do the same.
 */
export const AUDIO_OFFSET_SEC = 2.5;
const END_SEC = 3;
const TAIL_SEC = 0.4;

export interface NarrationLine {
  id: string;
  text: string;
  sceneId: string;
  sceneType: Scene['type'];
  /** Video time; null until the voice stage has timed the line. */
  startSec: number | null;
  endSec: number | null;
  mark: Mark;
  evidence: EvidenceRef[];
}

/**
 * Every narration line in storyboard order. Once timings exist, a line without one is left out: the
 * grounding stage dropped it, so it is not in the cut. Timings that name none of the storyboard's lines
 * belong to some other cut, and are ignored rather than allowed to empty the page.
 */
export function narrationLines(sb: Storyboard, timings: LineTiming[] | null, audioOffsetSec: number): NarrationLine[] {
  const ids = new Set(sb.scenes.flatMap((scene) => scene.lines.map((line) => line.id)));
  const matching = timings?.filter((t) => ids.has(t.lineId)) ?? [];
  const timed = matching.length > 0 ? new Map(matching.map((t) => [t.lineId, t])) : null;
  return sb.scenes.flatMap((scene) => {
    const mark: Mark = scene.type === 'flag' ? markFor(scene.verdict) : 'ring';
    return scene.lines.flatMap((line) => {
      const t = timed?.get(line.id);
      if (timed && !t) return [];
      return [{
        id: line.id,
        text: line.text,
        sceneId: scene.id,
        sceneType: scene.type,
        startSec: t ? t.startSec + audioOffsetSec : null,
        endSec: t ? t.endSec + audioOffsetSec : null,
        mark,
        evidence: line.evidence,
      }];
    });
  });
}

export interface SceneSpan { sceneId: string; type: Scene['type']; startSec: number; endSec: number }

/** Where each scene sits in the video, cut the way the renderer cuts it. Null until there are timings. */
export function sceneSpans(sb: Storyboard, timings: LineTiming[] | null, audioOffsetSec: number): SceneSpan[] | null {
  const lines = narrationLines(sb, timings, audioOffsetSec);
  if (lines.length === 0 || lines[0]!.startSec === null) return null;

  const spoken = sb.scenes.flatMap((scene) => {
    const own = lines.filter((l) => l.sceneId === scene.id);
    return own.length > 0 ? [{ scene, first: own[0]!.startSec!, last: own.at(-1)!.endSec! }] : [];
  });
  const spans: SceneSpan[] = [];
  const title = sb.scenes[0];
  if (title?.type === 'title') spans.push({ sceneId: title.id, type: 'title', startSec: 0, endSec: audioOffsetSec });
  spoken.forEach(({ scene, first, last }, i) => {
    const next = spoken[i + 1];
    spans.push({ sceneId: scene.id, type: scene.type, startSec: i === 0 ? audioOffsetSec : first, endSec: next ? next.first : last + TAIL_SEC });
  });
  const end = sb.scenes.at(-1);
  if (end?.type === 'end') {
    const at = spans.at(-1)?.endSec ?? audioOffsetSec;
    spans.push({ sceneId: end.id, type: 'end', startSec: at, endSec: at + END_SEC });
  }
  return spans;
}

/** "session s3 · entry 204" from an entry id of the form `${sessionId}:${index}`. */
export function entryLabel(entryId: string): string {
  const cut = entryId.lastIndexOf(':');
  const index = cut === -1 ? '' : entryId.slice(cut + 1);
  if (!/^\d+$/.test(index)) return `entry ${entryId}`;
  const session = entryId.slice(0, cut);
  return `session ${session.length > 12 ? session.slice(0, 8) : session} · entry ${index}`;
}

export type Source =
  | { kind: 'entry'; role: 'prompt' | 'command' | 'agent' | 'entry'; where: string; quote: string | null; body: string | null; command?: string; ok?: boolean }
  | { kind: 'diff'; path: string; sha: string; hunk: string | null; added: number | null; removed: number | null; quote: string | null }
  | { kind: 'stat'; key: string; label: string; value: string | null };

/**
 * What a piece of evidence opens to. The page is given the storyboard and the claims, not the transcript,
 * so an entry is readable when a scene or a claim quotes it; otherwise only its reference is shown.
 */
export function resolveSource(ref: EvidenceRef, ctx: { storyboard: Storyboard; claims: Claim[] }): Source {
  if (ref.type === 'stat') {
    for (const scene of ctx.storyboard.scenes) {
      const item = scene.type === 'stats' ? scene.items.find((i) => i.statKey === ref.key) : undefined;
      if (item) return { kind: 'stat', key: ref.key, label: item.label, value: item.value };
    }
    const fact = ctx.storyboard.facts[ref.key];
    return { kind: 'stat', key: ref.key, label: ref.key, value: fact === undefined ? null : String(fact) };
  }

  if (ref.type === 'diff') {
    const scene = ctx.storyboard.scenes.find((s) => s.type === 'diff' && s.sha === ref.sha && s.path === ref.path);
    const patch = scene?.type === 'diff' ? { hunk: scene.hunk, added: scene.added, removed: scene.removed } : { hunk: null, added: null, removed: null };
    return { kind: 'diff', path: ref.path, sha: ref.sha, ...patch, quote: ref.quote ?? null };
  }

  const base = { kind: 'entry' as const, where: entryLabel(ref.entryId), quote: ref.quote ?? null };
  for (const scene of ctx.storyboard.scenes) {
    if (scene.type === 'prompt' && scene.entryId === ref.entryId) return { ...base, role: 'prompt', body: scene.quote };
    const step = scene.type === 'terminal' ? scene.steps.find((s) => s.entryId === ref.entryId) : undefined;
    if (step) return { ...base, role: 'command', body: step.output, command: step.command, ok: step.ok };
  }
  const claim = ctx.claims.find((c) => c.entryId === ref.entryId);
  if (claim) return { ...base, role: 'agent', body: claim.quote };
  return { ...base, role: 'entry', body: null };
}

/**
 * The decisive part of a test runner's output: "2 failed", or "14 passed" when nothing failed.
 * Null for output that is not recognised, so the page never reads a pass into it.
 */
export function decisive(output: string): string | null {
  const lines = output.split('\n').filter((l) => /\b\d+ (failed|passed)\b/.test(l));
  const summary = lines.findLast((l) => /^\s*Tests\b/.test(l)) ?? lines.at(-1);
  if (!summary) return null;
  const failed = /\b(\d+) failed\b/.exec(summary);
  if (failed && Number(failed[1]) > 0) return `${failed[1]} failed`;
  const passed = /\b(\d+) passed\b/.exec(summary);
  return passed ? `${passed[1]} passed` : null;
}

// A loupe on a narration row is under 200 px across; more than this many characters cannot be read in it.
const FOCUS_MAX = 14;

function opening(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= FOCUS_MAX) return flat;
  const cut = flat.slice(0, FOCUS_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 5 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

/** The count a command source comes down to, read from the quoted span first and then from the whole output. */
const counted = (source: Source): string | null =>
  source.kind === 'entry' && source.role === 'command' ? decisive(source.quote ?? '') ?? decisive(source.body ?? '') : null;

/** The few words of a source that sit under the glass. */
export function focusOf(source: Source): string {
  if (source.kind === 'stat') return source.value ?? source.label;
  const count = counted(source);
  if (count) return count;
  if (source.quote) return opening(source.quote);
  if (source.kind === 'diff') {
    const added = source.hunk?.split('\n').find((l) => l.startsWith('+') && l.slice(1).trim().length > 0);
    return added ? opening(added.slice(1)) : opening(source.path.split('/').at(-1) ?? source.path);
  }
  if (source.role === 'command' && source.command) return opening(source.command);
  if (source.body) return opening(source.body);
  return opening(source.where.split(' · ').at(-1) ?? source.where);
}

/**
 * What goes under the glass for a line: the source that quotes a span, else the first one. A count or a
 * value is set in the display face, anything quoted from the record in the code face.
 */
export function lensOf(sources: Source[]): { focus: string; face: 'code' | 'disp' } | null {
  const source = sources.find((s) => s.kind !== 'stat' && s.quote) ?? sources[0];
  if (!source) return null;
  return { focus: focusOf(source), face: source.kind === 'stat' || counted(source) ? 'disp' : 'code' };
}

export interface FlagRow { id: string; verdict: Verdict; mark: Mark; quote: string; reality: string | null; where: string }

const FLAG_ORDER: Verdict[] = ['contradicted', 'stale', 'unverifiable'];

/** A claim nothing has judged is unverifiable: unknown is never verified. */
const verdictOf = (claim: Claim): Verdict => claim.verdict ?? 'unverifiable';

/** Every claim that did not hold, worst first, with what the record shows instead. */
export function flagRows(claims: Claim[], sb: Storyboard | null): FlagRow[] {
  const reality = new Map(sb?.scenes.flatMap((s) => (s.type === 'flag' ? [[s.claimId, s.reality] as const] : [])) ?? []);
  return FLAG_ORDER.flatMap((verdict) =>
    claims
      .filter((c) => verdictOf(c) === verdict)
      .map((c) => ({
        id: c.id,
        verdict,
        mark: markFor(verdict),
        quote: c.quote,
        reality: reality.get(c.id) ?? (c.reason ? sentence(c.reason) : null),
        where: entryLabel(c.entryId),
      })),
  );
}

export function claimCounts(claims: Claim[]): Record<Verdict, number> & { total: number } {
  const counts = { verified: 0, contradicted: 0, stale: 0, unverifiable: 0, total: claims.length };
  for (const claim of claims) counts[verdictOf(claim)] += 1;
  return counts;
}

/** The renderer writes SubRip; a video track only loads WebVTT. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r\n?/g, '\n')
    .replace(/^(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/gm, '$1.$2 --> $3.$4');
  return `WEBVTT\n\n${body}`;
}
