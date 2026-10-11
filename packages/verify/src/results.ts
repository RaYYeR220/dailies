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

function parseTypecheckOutcome(text: string): RunOutcome {
  if (/error TS\d+/.test(text)) return 'fail';
  if (/Found [1-9]\d*\s+errors?/.test(text)) return 'fail';
  if (/Found 0 errors/.test(text)) return 'pass';
  if (text.trim() === '') return 'pass';
  return 'unknown';
}

function parseLintOrBuildOutcome(text: string): RunOutcome {
  if (/[1-9]\d*\s+errors?/.test(text)) return 'fail';
  if (/[1-9]\d*\s+problems?/.test(text)) return 'fail';
  if (text.trim() === '') return 'pass';
  if (/compiled successfully/.test(text)) return 'pass';
  if (/built in/.test(text)) return 'pass';
  if (/Done in/.test(text)) return 'pass';
  if (/0 errors/.test(text)) return 'pass';
  if (/0 problems/.test(text)) return 'pass';
  return 'unknown';
}

export function parseOutcome(cls: CommandClass, output: string, isError: boolean): RunOutcome {
  if (isError) return 'fail';
  const text = stripAnsi(output);
  if (cls === 'test') return parseTestOutcome(text);
  if (cls === 'typecheck') return parseTypecheckOutcome(text);
  return parseLintOrBuildOutcome(text);
}

export function collectRuns(session: Session): ToolRun[] {
  const runs: ToolRun[] = [];
  for (const call of session.entries) {
    if (call.kind !== 'tool_call' || !call.command || call.toolUseId === undefined) continue;
    const cls = classifyCommand(call.command);
    if (cls === 'other') continue;
    const result = session.entries.find((e) => e.kind === 'tool_result' && e.toolUseId === call.toolUseId);
    const outcome: RunOutcome = result ? parseOutcome(cls, result.text, result.isError ?? false) : 'unknown';
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
