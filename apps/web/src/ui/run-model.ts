import { sentence } from './format';
import { formatCost, STAGE_NAMES, type StageName, type StageState } from './model';

export interface RunEvent { id: number; ts: string; stage: string | null; message: string }

/** Appends what is new, in id order. Returns `prev` itself when nothing is, so the log does not re-render. */
export function mergeEvents(prev: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const seen = new Set(prev.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort((a, b) => a.id - b.id);
}

/** The last thing a stage logged: what its frame on the strip says once it is done. */
export function stageNote(events: RunEvent[], stage: string): string | null {
  return events.findLast((e) => e.stage === stage)?.message ?? null;
}

export interface GateCheck { name: string; pass: boolean; reasons: string[] }
export interface GateFrame { key: string; title: string; blurb: string; state: 'pending' | 'pass' | 'fail'; reasons: string[] }

const titled = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/**
 * The gate as frames: the four checks the pipeline always makes, each unmarked until the gate stage
 * reports it, followed by any check this page has not heard of.
 */
export function gateFrames(gate: { checks: GateCheck[] } | null, budgetUsd: number): GateFrame[] {
  const known = [
    { key: 'grounding', title: 'Grounding', blurb: 'Every narration line cites something the session recorded.' },
    { key: 'secrets', title: 'Secrets', blurb: 'No key or token appears in a frame or a line.' },
    { key: 'cost', title: 'Cost', blurb: `The run stays inside its ${formatCost(0, budgetUsd).split(' of ')[1]} budget.` },
    { key: 'review', title: 'Review', blurb: 'The self-review found nothing serious in the rendered reel.' },
  ];
  const checks = new Map((gate?.checks ?? []).map((c) => [c.name.trim().toLowerCase(), c]));
  const frames: GateFrame[] = known.map((k) => {
    const check = checks.get(k.key);
    checks.delete(k.key);
    return { ...k, state: check ? (check.pass ? 'pass' : 'fail') : 'pending', reasons: check?.reasons ?? [] };
  });
  for (const [key, check] of checks) {
    frames.push({ key, title: titled(key), blurb: '', state: check.pass ? 'pass' : 'fail', reasons: check.reasons });
  }
  return frames;
}

export type RunStatus = 'running' | 'needs_approval' | 'blocked' | 'failed';

type StageStates = { name: StageName; state: StageState }[];

/**
 * The stage the loupe rests on: the one running, the next one between two stages, or the one that ended
 * the run. A stage that blocks is marked done, except on a budget stop, which leaves it running.
 */
export function focusStage(status: RunStatus, states: StageStates): number {
  const last = STAGE_NAMES.length - 1;
  const first = (state: StageState) => states.findIndex((s) => s.state === state);
  const lastDone = states.findLastIndex((s) => s.state === 'done');
  if (status === 'failed' && first('failed') !== -1) return first('failed');
  if (first('running') !== -1) return first('running');
  if (status === 'running' || status === 'failed') return Math.min(lastDone + 1, last);
  return Math.max(lastDone, 0);
}

/** The page's one-line summary: where the run is, or how it ended. */
export function runHeadline(status: RunStatus, states: StageStates): { lead: string; strong: string } {
  const total = STAGE_NAMES.length;
  const stage = focusStage(status, states) + 1;

  if (status === 'needs_approval') return { lead: 'The cut is ready.', strong: 'Waiting for your review.' };
  if (status === 'failed') return { lead: 'The run stopped.', strong: `Stage ${stage} of ${total} failed.` };
  if (status === 'blocked') return { lead: 'The run stopped.', strong: stage === total ? 'Blocked at the gate.' : `Blocked at stage ${stage} of ${total}.` };
  if (states.every((s) => s.state === 'waiting')) return { lead: 'In the queue.', strong: 'Waiting for the worker.' };
  return { lead: 'Reading the night.', strong: `Stage ${stage} of ${total}.` };
}

const listed = (words: string[]) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/** The gate in a line: not reached, clean, or what stopped the run. `ended` says the run is over. */
export function gateSummary(frames: GateFrame[], ended = false): { count: string; line: string } {
  const failed = frames.filter((f) => f.state === 'fail');
  const passed = frames.filter((f) => f.state === 'pass');
  if (failed.length > 0) {
    return { count: `${failed.length} of ${frames.length} failed`, line: `Stopped at the gate: ${listed(failed.map((f) => f.title.toLowerCase()))}.` };
  }
  if (passed.length === frames.length) {
    return { count: `${passed.length} of ${frames.length} passed`, line: 'The gate is clean. The reel can go to a person for approval.' };
  }
  if (ended) return { count: `${frames.length} checks, never reached`, line: 'The run stopped before it got to the gate.' };
  return {
    count: passed.length > 0 ? `${passed.length} of ${frames.length} passed` : `${frames.length} checks, not reached yet`,
    line: 'Nothing leaves this run until every check is ringed.',
  };
}

const REASONS: Record<string, string> = {
  budget: 'The run reached its cost budget before the reel was finished.',
};

/** Why a run was blocked or failed, as a sentence. */
export function reasonInWords(reason: string | null): string {
  const r = reason?.trim();
  if (!r) return 'No reason was recorded.';
  return REASONS[r] ?? sentence(r);
}

/** What a visitor typed, as the address the API accepts, or null. The API has the last word. */
export function normalizeRepoInput(input: string): string | null {
  const text = input.trim().replace(/^(https?:\/\/)?(www\.)?/i, '');
  const match = /^github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(\.git)?\/?$/.exec(text);
  return match ? `https://github.com/${match[1]}/${match[2]}${match[3] ?? ''}` : null;
}

export const NOT_A_REPO = 'That is not a GitHub repository address. It should look like github.com/owner/repo.';

/** Why `POST /api/runs` refused, in words. */
export function refusalInWords(status: number, body: { error?: string; reason?: string } | null): string {
  if (status === 429) {
    return body?.reason === 'rate_limited_global'
      ? 'Dailies has reached its limit of runs for today. Try again tomorrow.'
      : 'This address has started all the runs it can today. Try again tomorrow.';
  }
  if (status === 400) {
    return body?.error?.startsWith('since') ? 'The server did not accept the time window.' : NOT_A_REPO;
  }
  return `The server could not start the run (error ${status}). Try again in a minute.`;
}
