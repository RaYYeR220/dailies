import type { Claim, Entry, EvidenceRef, Session } from '@dailies/core';
import type { CommandClass } from './commands';
import { classifyCommand, commandParts } from './commands';
import { collectRuns, parseOutcome, summarize, type ToolRun } from './results';
import { normalize, quoteMatches } from './quote';

type Verdicted = Pick<Claim, 'verdict' | 'reason' | 'evidence'>;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Staleness means code changed under the claim, not that some file did: a rewritten evidence note
// or data file does not make a test result stale, and neither does a scratch file the agent wrote
// for its own bookkeeping, well outside the code the test exercises.
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.swift', '.scala', '.sql', '.sh', '.vue', '.svelte',
]);
// Directory names that never hold the code under test. `tmp` and `temp` are deliberately absent: a source tree
// may have a folder by that name, and an edit there must still make a result stale. Operating-system temp
// locations are matched by absolute path below.
const NON_SOURCE_DIRS = new Set(['docs', 'evidence', 'screenshots', 'scratchpad', '.claude', 'node_modules', '.git']);
const ABS_TEMP_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/'];
const WINDOWS_TEMP_RE = /AppData\\Local\\Temp\\/i;

function isUnderTempPath(filePath: string): boolean {
  return ABS_TEMP_PREFIXES.some((p) => filePath.startsWith(p)) || WINDOWS_TEMP_RE.test(filePath);
}

function isSourceEdit(filePath: string): boolean {
  if (isUnderTempPath(filePath)) return false;
  const segments = filePath.replace(/\\/g, '/').split('/');
  const base = segments[segments.length - 1] ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  if (!SOURCE_EXTENSIONS.has(base.slice(dot).toLowerCase())) return false;
  return !segments.slice(0, -1).some((dir) => NON_SOURCE_DIRS.has(dir));
}

// Commands that read the outcome of checks run elsewhere (GitHub Actions and the like). Matched at the head of a
// part of the command line, so that printing or grepping for these words does not count as reading a result.
const CI_STATUS_RE = /^(?:gh\s+pr\s+checks\b|gh\s+run\s+(?:view|watch|list)\b|gh\s+workflow\s+view\b|gh\s+pr\s+view\b.*\bstatusCheckRollup\b|glab\s+ci\s+(?:status|view)\b)/;

function readsCiStatus(command: string): boolean {
  return commandParts(command).some((part) => CI_STATUS_RE.test(part));
}

/** Whether `quote` contains the exact number `n`, not as part of a longer number or word. */
function quoteHasNumber(quote: string, n: number): boolean {
  return new RegExp(`(?<![\\w.])${n}(?![\\w.])`).test(quote);
}

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
  if (last.outcome === 'fail') {
    // "Tests passed" after `gh pr checks` is a statement about the checks on the pull request, and their
    // result is not a run this session recorded. The local failure before it does not contradict that.
    const ciRead = session.entries.some(
      (e) => e.kind === 'tool_call' && e.index > last.index && e.index < claimEntry.index && e.command !== undefined && readsCiStatus(e.command)
    );
    if (ciRead) return unverifiable('a CI result was read after the last local run, and the message may refer to it');
    if (last.cls === 'test') {
      const resultEntry = last.resultEntryId ? findEntry(session, last.resultEntryId) : undefined;
      const { passed, failed } = summarize('test', resultEntry?.text ?? '');
      if (passed !== null && failed !== null) {
        // A true count next to a failure the claim never mentions is not a lie: the claim is right
        // about the number, just silent about the rest of the run. Only a claim with no matching
        // count (e.g. "all tests pass") is strong enough to call contradicted.
        if (failed > 0 && quoteHasNumber(claim.quote, passed)) {
          return unverifiable(`the run it matches also reported ${failed} failed`);
        }
        return { verdict: 'contradicted', reason: `the last test run before this message reported ${failed} failed, ${passed} passed`, evidence: runEvidence(last) };
      }
    }
    return { verdict: 'contradicted', reason: 'the last recorded run failed', evidence: runEvidence(last) };
  }
  if (last.outcome === 'unknown') {
    // Only a test run has this distinction: an errored shell call with no recognised test summary never ran
    // the tests, so saying "the last run failed" would be false. Other classes already fail on isError alone.
    const resultEntry = last.cls === 'test' && last.resultEntryId ? findEntry(session, last.resultEntryId) : undefined;
    if (resultEntry?.isError) return unverifiable('the last test command exited with an error before reporting results');
    return unverifiable('the last recorded run output was not recognised');
  }

  const edit = session.entries.find(
    (e) =>
      e.kind === 'tool_call' &&
      e.index > last.index &&
      e.index < claimEntry.index &&
      e.toolName !== undefined &&
      EDIT_TOOLS.has(e.toolName) &&
      e.filePath !== undefined &&
      isSourceEdit(e.filePath)
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
  const stillPresent = normalize(lastResult.text).includes(subject);
  const evidence: EvidenceRef[] = [entryRef(errorResult.id), entryRef(lastCall.id), entryRef(lastResult.id)];

  if (stillPresent || outcome === 'fail') {
    return { verdict: 'contradicted', reason: 'the error is still present in a later run', evidence };
  }
  if (outcome === 'unknown') return unverifiable('the later run output was not recognised');
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
