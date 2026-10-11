import type { Claim, Entry, Session } from '@dailies/core';
import type { CommandClass, ToolRun } from '@dailies/verify';
import { collectRuns } from '@dailies/verify';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function entryIndex(session: Session, entryId: string | null): number | null {
  if (entryId === null) return null;
  return session.entries.find((e) => e.id === entryId)?.index ?? null;
}

export type ClaimGapReason = 'no following assistant entry' | 'a source edit in between';

/** The next assistant entry after the run's result, and why `syntheticClaim` would decline to
 * anchor a claim there (null when it would succeed). Shared so a caller that needs to know why a
 * run was skipped doesn't re-derive the anchor logic. */
export function claimAnchor(session: Session, run: ToolRun): { assistant: Entry | undefined; gap: ClaimGapReason | null } {
  const afterIndex = entryIndex(session, run.resultEntryId) ?? run.index;
  const assistant = session.entries.find((e) => e.kind === 'assistant' && e.index > afterIndex);
  if (!assistant) return { assistant: undefined, gap: 'no following assistant entry' };

  const edit = session.entries.find(
    (e) =>
      e.kind === 'tool_call' &&
      e.index > afterIndex &&
      e.index < assistant.index &&
      e.toolName !== undefined &&
      EDIT_TOOLS.has(e.toolName) &&
      e.filePath !== undefined &&
      !e.filePath.endsWith('.md'),
  );
  if (edit) return { assistant, gap: 'a source edit in between' };
  return { assistant, gap: null };
}

/** Builds a tests_pass/build_passes claim anchored to the first assistant entry after the run's
 * result, or null when there is none or a non-markdown source edit sits between them. */
export function syntheticClaim(session: Session, run: ToolRun): Claim | null {
  const { assistant, gap } = claimAnchor(session, run);
  if (gap || !assistant) return null;

  return {
    id: `synthetic:${run.callEntryId}`,
    sessionId: session.id,
    entryId: assistant.id,
    quote: assistant.text.slice(0, 80),
    kind: run.cls === 'test' ? 'tests_pass' : 'build_passes',
    evidence: [],
  };
}

const CLASSES_FOR_CLAIM_KIND: Partial<Record<Claim['kind'], CommandClass[]>> = {
  tests_pass: ['test'],
  build_passes: ['build', 'typecheck', 'lint'],
};

/** True only when `run` is the last run of the claim's class group with an index before the
 * claim's entry — the run `verifyClaim`'s lastRunVerdict will actually rest the verdict on.
 * Several runs of the same class often precede one assistant message; mutating any run but this
 * one cannot change the verdict, since verifyClaim always recomputes "the last run" itself. */
export function isEvidencingRun(session: Session, run: ToolRun, claim: Claim): boolean {
  const claimEntry = session.entries.find((e) => e.id === claim.entryId);
  if (!claimEntry) return false;

  const classes = CLASSES_FOR_CLAIM_KIND[claim.kind];
  if (!classes) return false;

  const matching = collectRuns(session).filter((r) => classes.includes(r.cls) && r.index < claimEntry.index);
  const last = matching[matching.length - 1];
  return last !== undefined && last.callEntryId === run.callEntryId;
}

function canonicalOpposite(run: ToolRun, to: 'pass' | 'fail'): { text: string; isError: boolean } {
  if (run.cls === 'test') {
    return to === 'fail'
      ? { text: 'Tests  3 failed | 11 passed', isError: true }
      : { text: 'Tests  14 passed (14)', isError: false };
  }
  if (run.cls === 'typecheck') {
    return to === 'fail' ? { text: 'error TS2322: mutated', isError: true } : { text: '', isError: false };
  }
  // build/lint share parseLintOrBuildOutcome, whose fail marker is a leading count, not "error TSxxxx".
  return to === 'fail' ? { text: '3 errors', isError: true } : { text: '', isError: false };
}

/** Returns a copy of `session` with the targeted run's recorded result replaced by a canonical
 * opposite outcome; the original session and its other runs are untouched. */
export function mutateRun(session: Session, run: ToolRun, to: 'pass' | 'fail'): Session {
  const copy = structuredClone(session);
  const result = copy.entries.find((e) => e.id === run.resultEntryId);
  if (!result) return copy;
  const { text, isError } = canonicalOpposite(run, to);
  result.text = text;
  result.isError = isError;
  return copy;
}
