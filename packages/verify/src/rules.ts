import type { Claim, Entry, EvidenceRef, Session } from '@dailies/core';
import type { CommandClass } from './commands';
import { classifyCommand } from './commands';
import { collectRuns, parseOutcome, type ToolRun } from './results';
import { normalize, quoteMatches } from './quote';

type Verdicted = Pick<Claim, 'verdict' | 'reason' | 'evidence'>;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function findEntry(session: Session, entryId: string): Entry | undefined {
  return session.entries.find((e) => e.id === entryId);
}

function entryRef(entryId: string): EvidenceRef {
  return { type: 'entry', entryId };
}

function runEvidence(run: ToolRun): EvidenceRef[] {
  const refs: EvidenceRef[] = [entryRef(run.callEntryId)];
  if (run.resultEntryId) refs.push(entryRef(run.resultEntryId));
  return refs;
}

function unverifiable(reason: string): Verdicted {
  return { verdict: 'unverifiable', reason, evidence: [] };
}

// Shared by tests_pass (class ['test']) and build_passes (classes ['build', 'typecheck', 'lint']):
// consider the last matching run before the claim's entry, then check for an edit since.
function lastRunVerdict(claim: Claim, session: Session, classes: CommandClass[], noRunReason: string): Verdicted {
  const claimEntry = findEntry(session, claim.entryId);
  if (!claimEntry) return unverifiable('claim entry not found in session');

  const runs = collectRuns(session).filter((r) => classes.includes(r.cls) && r.index < claimEntry.index);
  if (runs.length === 0) return unverifiable(noRunReason);

  const last = runs[runs.length - 1]!;
  if (last.outcome === 'fail') return { verdict: 'contradicted', reason: 'the last recorded run failed', evidence: runEvidence(last) };
  if (last.outcome === 'unknown') return unverifiable('the last recorded run output was not recognised');

  const edit = session.entries.find(
    (e) =>
      e.kind === 'tool_call' &&
      e.index > last.index &&
      e.index < claimEntry.index &&
      e.toolName !== undefined &&
      EDIT_TOOLS.has(e.toolName) &&
      e.filePath !== undefined &&
      !e.filePath.endsWith('.md')
  );
  if (edit) {
    return {
      verdict: 'stale',
      reason: 'a source file was edited after the last passing run',
      evidence: [entryRef(edit.id), ...runEvidence(last)],
    };
  }
  return { verdict: 'verified', reason: 'the last recorded run passed with no edits after', evidence: runEvidence(last) };
}

function ranCommand(claim: Claim, session: Session): Verdicted {
  const claimEntry = findEntry(session, claim.entryId);
  if (!claimEntry || !claim.subject) return unverifiable('no matching command is recorded before this message');

  const subject = normalize(claim.subject);
  if (!subject) return unverifiable('no matching command is recorded before this message');
  const calls = session.entries.filter(
    (e) => e.kind === 'tool_call' && e.index < claimEntry.index && e.command && normalize(e.command).includes(subject)
  );
  if (calls.length === 0) return unverifiable('no matching command is recorded before this message');

  const call = calls[calls.length - 1]!;
  const result = session.entries.find((e) => e.kind === 'tool_result' && e.toolUseId === call.toolUseId);
  if (!result) return unverifiable('the matching command has no recorded result');

  const evidence = [entryRef(call.id), entryRef(result.id)];
  if (result.isError) return { verdict: 'contradicted', reason: 'the matching command errored', evidence };
  return { verdict: 'verified', reason: 'the matching command succeeded', evidence };
}

function fixedError(claim: Claim, session: Session): Verdicted {
  const claimEntry = findEntry(session, claim.entryId);
  if (!claimEntry || !claim.subject) return unverifiable('no error text is recorded for this claim');

  const subject = normalize(claim.subject);
  if (!subject) return unverifiable('no error text is recorded for this claim');
  const errorResult = session.entries.find(
    (e) => e.kind === 'tool_result' && e.index < claimEntry.index && normalize(e.text).includes(subject)
  );
  if (!errorResult) return unverifiable('the error text is not recorded in any tool result');

  const errorCall = session.entries.find((e) => e.kind === 'tool_call' && e.toolUseId === errorResult.toolUseId);
  if (!errorCall || !errorCall.command) return unverifiable('the failing command is not recorded');
  const cls = classifyCommand(errorCall.command);

  const laterCalls = session.entries.filter(
    (e) =>
      e.kind === 'tool_call' &&
      e.index > errorResult.index &&
      e.index < claimEntry.index &&
      e.command &&
      classifyCommand(e.command) === cls
  );
  if (laterCalls.length === 0) return unverifiable('no later run of the same kind is recorded before this message');

  const lastCall = laterCalls[laterCalls.length - 1]!;
  const lastResult = session.entries.find((e) => e.kind === 'tool_result' && e.toolUseId === lastCall.toolUseId);
  if (!lastResult) return unverifiable('the later run has no recorded result');

  const outcome = parseOutcome(cls, lastResult.text, lastResult.isError ?? false);
  if (outcome === 'unknown') return unverifiable('the later run output was not recognised');

  const stillPresent = normalize(lastResult.text).includes(subject);
  const evidence: EvidenceRef[] = [entryRef(errorResult.id), entryRef(lastCall.id), entryRef(lastResult.id)];

  if (stillPresent || outcome === 'fail') {
    return { verdict: 'contradicted', reason: 'the error is still present in a later run', evidence };
  }
  return { verdict: 'verified', reason: 'a later run no longer shows the error', evidence };
}

export function verifyClaim(claim: Claim, session: Session): Claim {
  if (claim.kind === 'implemented') return claim;

  const entry = findEntry(session, claim.entryId);
  if (!entry || !quoteMatches(claim.quote, entry.text)) {
    return { ...claim, verdict: 'unverifiable', reason: 'quote not found in transcript', evidence: [] };
  }

  let result: Verdicted;
  switch (claim.kind) {
    case 'tests_pass':
      result = lastRunVerdict(claim, session, ['test'], 'no test run is recorded before this message');
      break;
    case 'build_passes':
      result = lastRunVerdict(claim, session, ['build', 'typecheck', 'lint'], 'no build, typecheck or lint run is recorded before this message');
      break;
    case 'ran_command':
      result = ranCommand(claim, session);
      break;
    case 'fixed_error':
      result = fixedError(claim, session);
      break;
    default:
      result = unverifiable('unknown claim kind');
  }
  return { ...claim, ...result };
}

export function verifyClaims(claims: Claim[], sessions: Session[]): Claim[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return claims.map((c) => {
    const session = byId.get(c.sessionId);
    if (!session) return { ...c, verdict: 'unverifiable', reason: 'session not found', evidence: [] };
    return verifyClaim(c, session);
  });
}
