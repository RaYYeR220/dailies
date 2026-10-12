import { z } from 'zod';
import { completeJson, type ModelClient } from '@dailies/agent';
import { ClaimKind, type Claim, type DiffIndex, type Entry, type IngestArtifact, type Session } from '@dailies/core';
import { normalize, quoteMatches, verifyClaims } from '@dailies/verify';
import { extractorPrompt } from '../prompts/extractor';
import { judgePrompt } from '../prompts/judge';
import type { Stage } from '../types';
import { cut, oneLine } from './edit';
import { StageBudgetError, stageMeter } from '../budget';
import type { StageDeps } from './index';

type Verdict = NonNullable<Claim['verdict']>;

export interface VerifyArtifact { claims: Claim[]; counts: Record<Verdict, number> }

const BATCH = 30;
const MESSAGE_CHARS = 4000;
const JUDGE_PATCH_CHARS = 4000;
const JUDGE_BUDGET_CHARS = 24000;
// A judge quote shorter than this ("}", "+") is in every patch and shows nothing.
const MIN_JUDGE_QUOTE_CHARS = 8;
const SUBJECT_CHARS = 200;
const MAX_NOT_SHOWN = 40;
const VERIFY_BUDGET_SHARE = 0.3;
const BUDGET_REASON = 'not checked: verification budget reached';

const ExtractorReply = z.object({
  claims: z.array(z.object({ entryId: z.string(), quote: z.string(), kind: ClaimKind, subject: z.string().nullish() })),
});
const JudgeReply = z.object({ supported: z.boolean(), path: z.string().nullish(), quote: z.string().nullish() });

/** The assistant entries that close a turn: the last one before each human prompt, and the last one of the session. */
function turnEnds(session: Session): Entry[] {
  const ends: Entry[] = [];
  let last: Entry | null = null;
  for (const entry of session.entries) {
    if (entry.kind === 'assistant' && entry.text.trim() !== '') last = entry;
    else if (entry.kind === 'user' && last) {
      ends.push(last);
      last = null;
    }
  }
  if (last) ends.push(last);
  return ends;
}

/** The lines a patch adds or removes, markers kept. Headers and context are not changes and cannot support a claim. */
function changedLines(patch: string): string[] {
  return patch.split('\n').filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')));
}

function sessionPatches(session: Session, diffs: DiffIndex): { sha: string; path: string; patch: string }[] {
  return session.commits.flatMap((sha) =>
    Object.entries(diffs)
      .filter(([key]) => key.startsWith(`${sha}:`))
      .map(([key, patch]) => ({ sha, path: key.slice(sha.length + 1), patch })),
  );
}

export function verifyStage(deps: StageDeps): Stage<VerifyArtifact> {
  const unverifiable = (claim: Claim, reason: string): Claim => ({ ...claim, verdict: 'unverifiable', reason, evidence: [] });

  /** Claims the extractor found in one session. One whose quote is not in the entry it names is not a claim. */
  async function extract(session: Session, nextId: () => string, seen: Set<string>, client: ModelClient): Promise<{ kept: Claim[]; dropped: number }> {
    const ends = turnEnds(session);
    const kept: Claim[] = [];
    let dropped = 0;
    for (let at = 0; at < ends.length; at += BATCH) {
      const batch = new Map(ends.slice(at, at + BATCH).map((e) => [e.id, e]));
      const { system, user } = extractorPrompt({
        sessionId: session.id,
        messages: [...batch.values()].map((e) => ({ entryId: e.id, text: cut(e.text, MESSAGE_CHARS) })),
      });
      const reply = await completeJson({ client, role: 'extractor', name: 'extractor', system, user, output: ExtractorReply });
      for (const raw of reply.claims) {
        const entry = batch.get(raw.entryId);
        const key = `${raw.entryId}|${raw.kind}|${normalize(raw.quote)}`;
        if (!entry || normalize(raw.quote) === '' || !quoteMatches(raw.quote, entry.text)) dropped += 1;
        else if (!seen.has(key)) {
          seen.add(key);
          // The subject is model output about untrusted text and is passed on to the judge: one bounded line, nothing else.
          const subject = raw.subject ? oneLine(raw.subject, SUBJECT_CHARS) : undefined;
          kept.push({ id: nextId(), sessionId: session.id, entryId: entry.id, quote: raw.quote, kind: raw.kind, subject, evidence: [] });
        }
      }
    }
    return { kept, dropped };
  }

  /**
   * `verified` only when the judge quotes one added or removed line of the file it names, out of the patch text
   * it was actually shown. Anything else is unverifiable.
   */
  async function judgeImplemented(claim: Claim, session: Session | undefined, diffs: DiffIndex, client: ModelClient): Promise<Claim> {
    const patches = session ? sessionPatches(session, diffs) : [];
    if (patches.length === 0) return unverifiable(claim, 'no commit diff is linked to this session');

    const shown: typeof patches = [];
    let room = JUDGE_BUDGET_CHARS;
    for (const p of patches) {
      if (room <= 0) break;
      const patch = cut(p.patch, Math.min(JUDGE_PATCH_CHARS, room));
      shown.push({ ...p, patch });
      room -= patch.length;
    }
    const { system, user } = judgePrompt({ quote: claim.quote, subject: claim.subject, patches: shown, notShown: patches.slice(shown.length, shown.length + MAX_NOT_SHOWN).map((p) => p.path) });
    const reply = await completeJson({ client, role: 'judge', name: 'judge', system, user, output: JudgeReply });

    if (!reply.supported) return unverifiable(claim, 'the judge found no supporting change in the diff');
    const quote = reply.quote ?? '';
    if (!reply.path || normalize(quote).length < MIN_JUDGE_QUOTE_CHARS) return unverifiable(claim, 'the judge did not quote a line of the diff');
    const hit = shown.find((p) => p.path === reply.path && changedLines(p.patch).some((line) => quoteMatches(quote, line)));
    if (!hit) return unverifiable(claim, 'the judge quote is not in the diff');
    return { ...claim, verdict: 'verified', reason: 'the diff contains the quoted change', evidence: [{ type: 'diff', sha: hit.sha, path: hit.path, quote }] };
  }

  return {
    name: 'verify',
    maxAttempts: 3,
    async run(ctx) {
      const ingest = ctx.read<IngestArtifact>('ingest');
      const sessions = new Map(ingest.sessions.map((s) => [s.id, s]));

      // Extraction is never budget-gated: it is what finds the deterministic-kind claims (tests_pass,
      // build_passes, ran_command, fixed_error), and those are judged by rule, with no model call of
      // their own, so cutting extraction short would be the one way the budget could still silently
      // skip a session's lie. Only the implemented-claim judge calls, which are genuinely optional
      // model spend on top of extraction, are capped by the stage's share.
      let n = 0;
      const nextId = () => `c_${(n += 1)}`;
      const seen = new Set<string>();
      const extracted: Claim[] = [];
      let dropped = 0;
      for (const session of ingest.sessions) {
        const found = await extract(session, nextId, seen, deps.client);
        extracted.push(...found.kept);
        dropped += found.dropped;
      }

      const budget = stageMeter(deps.meter, ctx.run.budget.maxCostPerReelUsd * VERIFY_BUDGET_SHARE);
      const checkedClient: ModelClient = { complete: async (req) => { budget.check(); return deps.client.complete(req); } };
      let budgetReached = false;

      const claims: Claim[] = [];
      let notChecked = 0;
      for (const claim of verifyClaims(extracted, ingest.sessions)) {
        if (claim.kind !== 'implemented') {
          claims.push(claim.verdict ? claim : unverifiable(claim, 'no rule judged this claim'));
          continue;
        }
        if (budgetReached) {
          claims.push(unverifiable(claim, BUDGET_REASON));
          notChecked += 1;
          continue;
        }
        try {
          claims.push(await judgeImplemented(claim, sessions.get(claim.sessionId), ingest.diffs, checkedClient));
        } catch (err) {
          if (!(err instanceof StageBudgetError)) throw err;
          budgetReached = true;
          claims.push(unverifiable(claim, BUDGET_REASON));
          notChecked += 1;
        }
      }
      if (notChecked > 0) ctx.log(`${notChecked} implemented claim(s) not checked: verification budget reached`);

      const counts: Record<Verdict, number> = { verified: 0, contradicted: 0, stale: 0, unverifiable: 0 };
      for (const claim of claims) counts[claim.verdict!] += 1;
      ctx.log(`${claims.length} claims (${dropped} dropped for a quote not in the transcript): ${counts.verified} verified, ${counts.contradicted} contradicted, ${counts.stale} stale, ${counts.unverifiable} unverifiable`);
      return { artifact: { claims, counts } };
    },
  };
}
