import type { Claim, LineTiming, Storyboard } from '@dailies/core';
import type { GateCheck, RunStatus } from './run-model';

/** A run as `GET /api/runs/[id]` returns it, with the budget reduced to the one number the pages show. */
export interface RunInfo {
  id: string;
  repoUrl: string;
  since: string;
  until: string;
  status: RunStatus;
  reason: string | null;
  costUsd: number;
  loops: number;
  budgetUsd: number;
  createdAt: string;
}

export interface StageInfo {
  name: string;
  status: string;
  attempt: number;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

export interface Gate { checks: GateCheck[] }

/** What `GET /api/reels/[id]` returns, checked. */
export interface ReelData {
  run: RunInfo;
  reel: { runId: string; status: 'draft' | 'approved'; approvedAt: string | null };
  storyboard: Storyboard | null;
  claims: Claim[];
  timings: LineTiming[] | null;
  voiceMode: 'voiced' | 'captions' | null;
  gate: Gate | null;
  media: { video: string | null; subtitles: string | null; poster: string | null };
}

export interface ApprovedReel { runId: string; repoUrl: string; approvedAt: string }
