import { z } from 'zod';
import { completeJson, guard } from '@dailies/agent';
import { Line, Storyboard, type DiffIndex, type EvidenceRef, type Facts, type IngestArtifact, type Scene, type Session } from '@dailies/core';
import { checkLine } from '@dailies/verify';
import { entailPrompt } from '../prompts/entail';
import { recorded } from '../prompts/judge';
import { rewritePrompt } from '../prompts/writer';
import type { Stage, StageResult } from '../types';
import { cut, oneLine } from './edit';
import type { StageDeps } from './index';
import type { ScriptArtifact } from './script';

export interface GroundArtifact { storyboard: Storyboard; dropped: { lineId: string; reasons: string[] }[]; kept: number }

export interface LineContext { sessions: Session[]; facts: Facts; diffs: DiffIndex }

const MAX_REWRITES = 2;
const MIN_SPOKEN_SCENES = 2;
const EVIDENCE_CHARS = 2000;
const REASON_CHARS = 1500;
const ONE_REASON_CHARS = 200;
const NOT_ENTAILED = 'not entailed by its evidence';
const INVALID_REWRITE = 'the rewrite was not a valid line';

const Entailment = z.object({ entailed: z.boolean() });
const Rewrite = z.object({ text: z.string(), evidence: z.array(z.unknown()).nullish() });

/**
 * Whether every reference of a line points at something in the record, and every quote is found where it points.
 * This is the whole check for a flag line. Its words are a literal quote and a fixed sentence, so the style lint
 * does not apply, and the number check could only fail it for the wrong reason: a quote such as "v2" or "22.1.0"
 * holds digits that check does not find in the very entry the quote was taken from.
 */
export function evidenceResolves(line: Line, record: LineContext): { ok: boolean; reasons: string[] } {
  return checked({ ...line, text: '-' }, record, { skipStyle: true });
}

/**
 * `checkLine`, with each reason as one bounded line. A reason names the reference that failed, in the words a
 * model chose for it, and it travels on: into the rewrite prompt, the loop-back feedback and the run record.
 */
export function checked(line: Line, record: LineContext, o: { skipStyle?: boolean } = {}): { ok: boolean; reasons: string[] } {
  const result = checkLine(line, record, o);
  return { ok: result.ok, reasons: result.reasons.map((reason) => oneLine(reason, ONE_REASON_CHARS)) };
}

/** `text` in at most `max` characters, around `quote` when the quote is in it. */
function excerpt(text: string, quote: string | undefined, max: number): string {
  if (text.length <= max) return text;
  const at = quote ? text.indexOf(quote) : -1;
  if (at === -1) return cut(text, max);
  const start = Math.max(0, Math.min(at - Math.floor((max - quote!.length) / 2), text.length - max));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + max)}${start + max < text.length ? '…' : ''}`;
}

/** A reference with the text it resolves to, for a model to read. */
function evidenceText(ref: EvidenceRef, record: LineContext): string {
  if (ref.type === 'stat') {
    return Object.hasOwn(record.facts, ref.key) ? `stat ${ref.key} = ${record.facts[ref.key]}` : `${JSON.stringify(ref)}\n(does not resolve)`;
  }
  const text = ref.type === 'entry' ? record.sessions.flatMap((s) => s.entries).find((e) => e.id === ref.entryId)?.text : record.diffs[`${ref.sha}:${ref.path}`];
  return `${JSON.stringify(ref)}\n${text === undefined ? '(does not resolve)' : recorded(excerpt(text, ref.quote, EVIDENCE_CHARS))}`;
}

export function groundStage(deps: StageDeps): Stage<GroundArtifact> {
  return {
    name: 'ground',
    maxAttempts: 3,
    async run(ctx) {
      const { storyboard } = ctx.read<ScriptArtifact>('script');
      const ingest = ctx.read<IngestArtifact>('ingest');
      const record: LineContext = { sessions: ingest.sessions, facts: storyboard.facts, diffs: ingest.diffs };
      const cited = (line: Line) => line.evidence.map((ref) => evidenceText(ref, record));

      /** Why a line may not be spoken: what the checks in code found, or, when they pass, the entailment judge's no. */
      const failures = async (line: Line): Promise<string[]> => {
        const inCode = checked(line, record);
        if (!inCode.ok) return inCode.reasons;
        const { system, user } = entailPrompt({ line: line.text, evidence: cited(line) });
        const { entailed } = await completeJson({ client: deps.client, role: 'judge', name: 'entailment', system, user, output: Entailment });
        return entailed ? [] : [NOT_ENTAILED];
      };

      /** The line as it may be spoken, after at most two rewrites; or the reasons it may not. */
      const ground = async (line: Line): Promise<{ line: Line } | { reasons: string[] }> => {
        let current = line;
        let reasons = await failures(current);
        for (let n = 0; reasons.length > 0 && n < MAX_REWRITES; n += 1) {
          const { system, user } = rewritePrompt({ line: current.text, reasons, evidence: cited(current) });
          const reply = await completeJson({ client: deps.client, role: 'writer', name: 'rewriter', system, user, output: Rewrite });
          const rewritten = Line.safeParse({ id: line.id, text: reply.text.trim(), evidence: reply.evidence ?? current.evidence });
          if (rewritten.success) {
            current = rewritten.data;
            reasons = await failures(current);
          } else if (!reasons.includes(INVALID_REWRITE)) reasons = [...reasons, INVALID_REWRITE];
        }
        return reasons.length === 0 ? { line: current } : { reasons };
      };

      const out: { result?: StageResult<GroundArtifact> } = {};
      await guard('grounding', async () => {
        const dropped: GroundArtifact['dropped'] = [];
        const scenes: Scene[] = [];
        for (const scene of storyboard.scenes) {
          if (scene.type === 'title' || scene.type === 'end') scenes.push(scene);
          else if (scene.type === 'flag') {
            // Code wrote these lines and no model may touch them. A flag stands whole or not at all:
            // the claim without the record, or the record without the claim, would mislead.
            const reasons = [...new Set(scene.lines.flatMap((line) => evidenceResolves(line, record).reasons))];
            if (reasons.length === 0) scenes.push(scene);
            else dropped.push(...scene.lines.map((line) => ({ lineId: line.id, reasons })));
          } else {
            const lines: Line[] = [];
            for (const line of scene.lines) {
              const grounded = await ground(line);
              if ('line' in grounded) lines.push(grounded.line);
              else dropped.push({ lineId: line.id, reasons: grounded.reasons });
            }
            if (lines.length > 0) scenes.push({ ...scene, lines });
          }
        }

        const spoken = scenes.length - 2;   // all but the title and the end card
        const kept = scenes.reduce((n, scene) => n + scene.lines.length, 0);
        const artifact: GroundArtifact = { storyboard: Storyboard.parse({ ...storyboard, scenes }), dropped, kept };
        const reasons = dropped.map((d) => `${d.lineId}: ${d.reasons.join(', ')}`);
        ctx.log(`${kept} lines kept, ${dropped.length} dropped, ${spoken} spoken scenes`);

        const pass = spoken >= MIN_SPOKEN_SCENES;
        out.result = pass
          ? { artifact }
          : { artifact, loopBackTo: 'script', reason: cut(`only ${spoken} spoken scene${spoken === 1 ? '' : 's'} survived grounding; dropped ${reasons.join('; ')}`, REASON_CHARS) };
        return { pass, reasons };
      });
      if (!out.result) throw new Error('the grounding guard returned without a result');
      return out.result;
    },
  };
}
