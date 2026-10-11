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
      lines.push(`| ${repoKey(c.repo)} | ${c.sessionId} | ${c.command} | ${c.original} | ${c.verdictBefore} | ${c.verdictAfter} |`);
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
    for (const s of skipped) lines.push(`- ${repoKey(s.repo)}: ${s.reason}`);
  }

  if (tails.length > 0) {
    lines.push('');
    lines.push('## Unrecognised output tails');
    tails.forEach((t, i) => lines.push(`${i + 1}. (${t.count}x) \`${t.tail}\``));
  }

  return `${lines.join('\n')}\n`;
}
