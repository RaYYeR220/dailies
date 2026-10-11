import { classifyCommand } from '@dailies/verify';
import type { MutationCase } from './mutation';
import { repoKey } from './repoKey';
import type { TailCount } from './tails';

export interface ScorecardInput {
  date: string;
  mutation: { cases: MutationCase[]; recognised: number; unknown: number; flipRate: number };
  grounding: { fabricated: number; rejected: number; genuine: number; accepted: number };
  skipped: { repo: string; reason: string }[];
  tails?: TailCount[];
}

function recognitionRate(recognised: number, unknown: number): number {
  const total = recognised + unknown;
  return total === 0 ? 0 : recognised / total;
}

// Collapses line breaks and control characters (which would split a table row or list item
// across lines) and escapes the characters that would otherwise break a Markdown table cell or
// inline code span: a literal `|` adds a column, a backtick closes the span early.
function sanitizeCell(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\\/g, '\\\\') // escape pre-existing backslashes first, so a "\|" in the source can't
    .replace(/\|/g, '\\|') // absorb the pipe's own escaping backslash and leave the pipe bare
    .replace(/`/g, "'");
}

// Error messages from @dailies/ingest (e.g. NoCheckpointsError) embed the repo URL verbatim.
// Scrub it wherever it appears, not just in the dedicated `repo` field.
function scrubRepo(text: string, repo: string): string {
  return repo ? text.split(repo).join(repoKey(repo)) : text;
}

// Known enough, and inherently argument-free as bare program names, to publish as-is.
const KNOWN_PROGRAMS = new Set([
  'cd', 'ls', 'git', 'go', 'cargo', 'make', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'tsx',
  'python', 'python3', 'perl', 'ruby', 'tsc', 'eslint', 'biome', 'ruff', 'flake8', 'mypy',
  'pyright', 'pytest', 'jest', 'vitest', 'mocha', 'playwright', 'rspec', 'phpunit', 'dotnet',
  'bash', 'sh', 'echo', 'grep', 'sed', 'awk', 'curl', 'docker', 'mise',
]);

// A recorded command is arbitrary agent-authored shell text: it can carry a bare
// "github.com/owner/repo" module path (no scheme, so scrubRepo's exact-URL match misses it), an
// operator's local filesystem path with their username in it (seen verbatim in real data — a
// recorded `cd /Users/<name>/...`), or a leading `VAR=value` shell assignment whose value could
// be anything, including a secret under a name redact() doesn't recognise. There is no bounded
// set of patterns to scrub for all of that, so the command is never published raw: only its
// deterministic class, plus a program name taken strictly from a fixed allowlist (an unknown
// binary becomes "other"), survives.
export function safeCommand(command: string): string {
  const withoutAssignments = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
  const first = withoutAssignments.split(/\s+/)[0] ?? '';
  const base = first.split('/').pop() || first;
  const programName = KNOWN_PROGRAMS.has(base) ? base : 'other';
  return `${classifyCommand(command)}:${programName}`;
}

/** Renders the mutation/grounding totals and every non-flipping case as Markdown, identifying
 * repositories only by repoKey so a result never names one. */
export function buildScorecard(input: ScorecardInput): string {
  const { date, mutation, grounding, skipped, tails = [] } = input;
  const rate = recognitionRate(mutation.recognised, mutation.unknown);
  const nonFlipping = mutation.cases.filter((c) => !c.flipped);

  const lines: string[] = [];
  lines.push(`# Dailies evaluation scorecard — ${date}`, '');

  lines.push('## Mutation benchmark');
  lines.push(`- recognised: ${mutation.recognised}`);
  lines.push(`- unknown: ${mutation.unknown}`);
  lines.push(`- recognition rate: ${rate.toFixed(3)}`);
  lines.push(`- cases: ${mutation.cases.length}`);
  lines.push(`- flip rate: ${mutation.flipRate.toFixed(3)}`);
  lines.push('');

  lines.push('### Non-flipping cases');
  if (nonFlipping.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| repo | session | command | original | before | after |');
    lines.push('|---|---|---|---|---|---|');
    for (const c of nonFlipping) {
      const command = sanitizeCell(scrubRepo(safeCommand(c.command), c.repo));
      const sessionId = sanitizeCell(c.sessionId);
      lines.push(`| ${repoKey(c.repo)} | ${sessionId} | ${command} | ${c.original} | ${c.verdictBefore} | ${c.verdictAfter} |`);
    }
  }
  lines.push('');

  lines.push('## Grounding benchmark');
  lines.push(`- fabricated: ${grounding.fabricated}, rejected: ${grounding.rejected}`);
  lines.push(`- genuine: ${grounding.genuine}, accepted: ${grounding.accepted}`);
  lines.push('');

  lines.push('## Skipped repositories');
  if (skipped.length === 0) {
    lines.push('None.');
  } else {
    for (const s of skipped) lines.push(`- ${repoKey(s.repo)}: ${sanitizeCell(scrubRepo(s.reason, s.repo))}`);
  }

  if (tails.length > 0) {
    lines.push('');
    lines.push('## Unrecognised output tails');
    tails.forEach((t, i) => lines.push(`${i + 1}. (${t.count}x) \`${sanitizeCell(t.tail)}\``));
  }

  return `${lines.join('\n')}\n`;
}
