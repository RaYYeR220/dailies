import type { Session } from '@dailies/core';
import { classifyCommand, type CommandClass } from './commands';

export type RunOutcome = 'pass' | 'fail' | 'unknown';

export interface ToolRun {
  callEntryId: string;
  resultEntryId: string | null;
  index: number;
  command: string;
  cls: CommandClass;
  outcome: RunOutcome;
}

const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export interface TestSummary {
  passed: number | null;
  failed: number | null;
  outcome: RunOutcome;
}

interface SummaryEvent {
  failed: number | null;
  passed: number | null;
  outcome: 'pass' | 'fail';
}

// Every form of "a test run just reported its result" we recognise. A combined failed+passed clause
// is tried first, so "1 failed, 2 passed" reads as one summary and not two; a runner's explicit
// marker (a go package line, a cargo result) carries no count but still decides pass or fail. Matched
// per line (not across the whole text with a multiline flag) so a comma on an unrelated later line can
// never glue itself onto an earlier bare count.
const LINE_SUMMARY_RE = new RegExp(
  [
    String.raw`(?<cf>\d+)\s+(?:failed|failing)\s*[,|]\s*(?:\d+\s+\w+\s*,\s*)*(?<cp>\d+)\s+passed`,
    String.raw`(?<lf>\d+)\s+(?:failed|failing)\b`,
    String.raw`(?<lp>\d+)\s+passed\b`,
    String.raw`^(?<goOk>ok\s+\S)`,
    String.raw`^(?<goFail>FAIL)\b`,
    String.raw`^---\s+FAIL:\s+(?<goTestFail>\S)`,
    String.raw`^(?<filePass>PASS)\b`,
    String.raw`test result:\s*(?<cargo>ok|FAILED)`,
  ].join('|'),
  'g'
);

/** Every recognised test summary in `text`, in the order it appears. The last one is the run's outcome. */
function testSummaries(text: string): SummaryEvent[] {
  const events: SummaryEvent[] = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(LINE_SUMMARY_RE)) {
      const g = m.groups!;
      if (g.cf !== undefined) {
        const failed = Number(g.cf);
        events.push({ failed, passed: Number(g.cp), outcome: failed > 0 ? 'fail' : 'pass' });
      } else if (g.lf !== undefined) {
        const failed = Number(g.lf);
        events.push({ failed, passed: null, outcome: failed > 0 ? 'fail' : 'pass' });
      } else if (g.lp !== undefined) {
        events.push({ failed: null, passed: Number(g.lp), outcome: 'pass' });
      } else if (g.cargo !== undefined) {
        events.push({ failed: null, passed: null, outcome: g.cargo === 'ok' ? 'pass' : 'fail' });
      } else if (g.goOk !== undefined || g.filePass !== undefined) {
        events.push({ failed: null, passed: null, outcome: 'pass' });
      } else {
        // goFail or goTestFail: a runner's explicit failing marker, no count to report.
        events.push({ failed: null, passed: null, outcome: 'fail' });
      }
    }
  }
  return events;
}

/** The decisive test summary of a run's output: the last recognised one, or `unknown` with no counts. */
function summarizeTest(text: string): TestSummary {
  const events = testSummaries(text);
  const last = events[events.length - 1];
  if (!last) return { passed: null, failed: null, outcome: 'unknown' };
  // One command can run tests more than once (a test-first script fails on purpose, then passes; two suites
  // run back to back). The last summary decides a failure. A pass is stricter: an earlier failing summary in
  // the same output may belong to another suite, so a later pass does not clear it and the result is unknown.
  if (last.outcome === 'pass' && events.some((e) => e.outcome === 'fail')) return { passed: last.passed, failed: last.failed, outcome: 'unknown' };
  return { passed: last.passed, failed: last.failed, outcome: last.outcome };
}

// A pipe, a `;`, or a newline (bash chains statements on one exactly as it does on the other)
// reports the exit status of its last part, not the part that was actually classified; `||` is
// two `|` characters, so testing for `|` alone already covers it. A backgrounded command (`&`,
// not `&&`) reports the shell having started the job, never the job's own outcome, so it is just
// as untrustworthy; `&&` is excluded first so a chain that merely contains that token is not
// flagged by the lone-`&` check.
const UNTRUSTED_EXIT = /[|;\n\r]/;

function hasUntrustedExit(command: string): boolean {
  return UNTRUSTED_EXIT.test(command) || command.replace(/&&/g, '').includes('&');
}

function parseTypecheckOutcome(text: string, exitTrusted: boolean): RunOutcome {
  if (/error TS\d+/.test(text)) return 'fail';
  if (/Found [1-9]\d*\s+errors?/.test(text)) return 'fail';
  if (/Found 0 errors/.test(text)) return 'pass';
  if (text.trim() === '') return 'pass';
  if (exitTrusted) return 'pass';
  return 'unknown';
}

function parseLintOrBuildOutcome(text: string, exitTrusted: boolean): RunOutcome {
  if (/[1-9]\d*\s+errors?/.test(text)) return 'fail';
  if (/[1-9]\d*\s+problems?/.test(text)) return 'fail';
  if (text.trim() === '') return 'pass';
  if (/compiled successfully/.test(text)) return 'pass';
  if (/built in/.test(text)) return 'pass';
  if (/Done in/.test(text)) return 'pass';
  if (/0 errors/.test(text)) return 'pass';
  if (/0 problems/.test(text)) return 'pass';
  if (exitTrusted) return 'pass';
  return 'unknown';
}

/**
 * The decisive summary of a run's output: for the test class, the last recognised summary and its
 * counts (see `testSummaries`); for the others, a single pass/fail/unknown read with no counts.
 */
export function summarize(cls: CommandClass, output: string): TestSummary {
  const text = stripAnsi(output);
  if (cls === 'test') return summarizeTest(text);
  if (cls === 'typecheck') return { passed: null, failed: null, outcome: parseTypecheckOutcome(text, false) };
  if (cls === 'lint' || cls === 'build') return { passed: null, failed: null, outcome: parseLintOrBuildOutcome(text, false) };
  return { passed: null, failed: null, outcome: 'unknown' };
}

export function parseOutcome(cls: CommandClass, output: string, isError: boolean, o?: { exitTrusted?: boolean }): RunOutcome {
  if (cls === 'test') {
    // An errored command is not itself a failed test run: the shell can error before the tests ever
    // ran (a missing module, a bad flag). `fail` requires the recognised summary a test run actually
    // prints; an error status with no such summary just means the run's result cannot be read.
    const { outcome } = summarize(cls, output);
    return isError && outcome !== 'fail' ? 'unknown' : outcome;
  }
  const text = stripAnsi(output);
  if (isError) return 'fail';
  const exitTrusted = o?.exitTrusted ?? false;
  if (cls === 'typecheck') return parseTypecheckOutcome(text, exitTrusted);
  return parseLintOrBuildOutcome(text, exitTrusted);
}

export function collectRuns(session: Session): ToolRun[] {
  const runs: ToolRun[] = [];
  for (const call of session.entries) {
    if (call.kind !== 'tool_call' || !call.command || call.toolUseId === undefined) continue;
    const cls = classifyCommand(call.command);
    if (cls === 'other') continue;
    const result = session.entries.find((e) => e.kind === 'tool_result' && e.toolUseId === call.toolUseId);
    const exitTrusted = !hasUntrustedExit(call.command);
    const outcome: RunOutcome = result ? parseOutcome(cls, result.text, result.isError ?? false, { exitTrusted }) : 'unknown';
    runs.push({
      callEntryId: call.id,
      resultEntryId: result?.id ?? null,
      index: call.index,
      command: call.command,
      cls,
      outcome,
    });
  }
  return runs;
}

const HEADLINE_MAX_CHARS = 24;
const HEADLINE_FAIL = /(\d+)\s+(?:failed|failing)/g;
const HEADLINE_PASS = /(\d+)\s+passed/g;
const HEADLINE_ERROR = /(\d+)\s+(?:errors?|problems?)/g;

/** The last match of `re` in `text` whose captured count is at least `minCount`, or null. */
function lastHeadlineMatch(re: RegExp, text: string, minCount: number): string | null {
  let found: string | null = null;
  for (const m of text.matchAll(re)) {
    if (Number(m[1]) >= minCount) found = m[0];
  }
  return found;
}

function normalizeHeadline(fragment: string): string {
  return fragment.replace(/\s+/g, ' ').trim().slice(0, HEADLINE_MAX_CHARS);
}

/** The decisive fragment of a run's output ("14 passed", "2 failed", "0 errors"), or null when nothing in it says so. */
export function headlineFor(cls: CommandClass, output: string): string | null {
  const text = stripAnsi(output);
  if (cls === 'test') {
    const failed = lastHeadlineMatch(HEADLINE_FAIL, text, 1);
    if (failed) return normalizeHeadline(failed);
    const passed = lastHeadlineMatch(HEADLINE_PASS, text, 0);
    return passed ? normalizeHeadline(passed) : null;
  }
  if (cls === 'typecheck' || cls === 'lint' || cls === 'build') {
    const errors = lastHeadlineMatch(HEADLINE_ERROR, text, 0);
    return errors ? normalizeHeadline(errors) : null;
  }
  return null;
}
