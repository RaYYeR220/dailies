import type { EvidenceRef } from '@dailies/core';

export type Mark = 'ring' | 'cross' | 'dashed' | 'question';
export type Verdict = 'verified' | 'contradicted' | 'stale' | 'unverifiable';

const MARKS: Record<Verdict, Mark> = { verified: 'ring', contradicted: 'cross', stale: 'dashed', unverifiable: 'question' };

export function markFor(verdict: Verdict): Mark {
  return MARKS[verdict];
}

export const STAGE_NAMES = ['ingest', 'edit', 'verify', 'script', 'ground', 'voice', 'render', 'review', 'gate'] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export type StageState = 'done' | 'running' | 'waiting' | 'failed';

const STATES: Record<string, StageState> = { done: 'done', running: 'running', failed: 'failed' };

/** Always the nine stages, in pipeline order. A status this page does not know is waiting, never done. */
export function stageStates(stages: { name: string; status: string }[]): { name: StageName; state: StageState }[] {
  const byName = new Map(stages.map((s) => [s.name, s.status]));
  return STAGE_NAMES.map((name) => ({ name, state: STATES[byName.get(name) ?? ''] ?? 'waiting' }));
}

/** The line being spoken at `t` seconds of the video; the narration starts `audioOffsetSec` in. */
export function lineAt(
  timings: { lineId: string; startSec: number; endSec: number }[],
  t: number,
  audioOffsetSec: number,
): string | null {
  const sec = t - audioOffsetSec;
  return timings.find((l) => sec >= l.startSec && sec < l.endSec)?.lineId ?? null;
}

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;
const SHA = /^[0-9a-f]{7,40}$/i;

/** GitHub commit URL for a diff ref; null for entry and stat refs, and for anything that is not a sha on a GitHub repo. */
export function evidenceHref(ref: EvidenceRef, repoUrl: string): string | null {
  if (ref.type !== 'diff' || !SHA.test(ref.sha)) return null;
  const repo = GITHUB_REPO.exec(repoUrl);
  if (!repo) return null;
  return `https://github.com/${repo[1]}/${repo[2]}/commit/${ref.sha}`;
}

const dollars = (n: number) => `$${n.toFixed(2)}`;

export function formatCost(usd: number, budgetUsd: number): string {
  return `${dollars(usd)} of ${dollars(budgetUsd)}`;
}
