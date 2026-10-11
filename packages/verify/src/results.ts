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

function parseTestOutcome(text: string): RunOutcome {
  for (const m of text.matchAll(/(\d+)\s+(?:failed|failing)/g)) {
    if (Number(m[1]) > 0) return 'fail';
  }
  if (/Tests?:\s+\d+\s+failed/.test(text)) return 'fail';
  if (/^FAIL\b/m.test(text)) return 'fail';
  if (/AssertionError/.test(text)) return 'fail';

  if (/\d+\s+passed/.test(text)) return 'pass';
  if (/^PASS\b/m.test(text)) return 'pass';
  if (/^ok\s+\S/m.test(text)) return 'pass';
  if (/test result: ok/.test(text)) return 'pass';

  return 'unknown';
}

// A pipe or a chained command reports the exit status of its last part, not the part that was
// actually classified; `||` is two `|` characters, so testing for `|` alone already covers it.
// A backgrounded command (`&`, not `&&`) reports the shell having started the job, never the
// job's own outcome, so it is just as untrustworthy; `&&` is excluded first so a chain that
// merely contains that token is not flagged by the lone-`&` check.
const UNTRUSTED_EXIT = /[|;]/;

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

export function parseOutcome(cls: CommandClass, output: string, isError: boolean, o?: { exitTrusted?: boolean }): RunOutcome {
  if (isError) return 'fail';
  const text = stripAnsi(output);
  if (cls === 'test') return parseTestOutcome(text);
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
