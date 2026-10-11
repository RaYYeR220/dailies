'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clock, repoName, stamp, windowLabel } from './format';
import { Loupe } from './Loupe';
import { Penciled } from './Mark';
import { Meter } from './Meter';
import { formatCost, stageStates, type StageName, type StageState } from './model';
import { crossPath, ringPath } from './pencil';
import { focusStage, gateFrames, gateSummary, reasonInWords, runHeadline, stageNote, type GateFrame, type RunStatus } from './run-model';
import { TopBar } from './TopBar';
import type { RunInfo, StageInfo } from './types';
import { useRunFeed, type FeedState } from './useRunFeed';
import film from './film.module.css';
import pill from './pill.module.css';
import styles from './RunView.module.css';

const LOG_SHOWN = 300;

const seconds = (fromIso: string | null, toIso: string | null) => {
  if (!fromIso || !toIso) return null;
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
};

/** The current time, once a second while `on`. Null on the server and for the first paint, so both render alike. */
function useNow(on: boolean): string | null {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    setNow(new Date().toISOString());
    if (!on) return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

const STATE_WORD: Record<RunStatus, string> = {
  running: 'Run in progress',
  needs_approval: 'Waiting for your review',
  blocked: 'Blocked',
  failed: 'Failed',
};

const pencil = { fill: 'none', stroke: '#ffd60a', strokeWidth: 15, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, filter: 'url(#pencil)' };

/** What is under the glass on the stage strip: the running stage and its clock, or how the run ended. */
function StageLens({ name, status, elapsed, attempt, queued, compact = false }: { name: StageName; status: RunStatus; elapsed: string | null; attempt: number; queued: boolean; compact?: boolean }) {
  const label = (y: number, size: number, text: string, weight = 600, opacity = 1) => (
    <text className="disp" x="0" y={y} textAnchor="middle" fontSize={size} fontWeight={weight} fill="#eef3f1" fillOpacity={opacity} letterSpacing={-size * 0.02}>{text}</text>
  );
  if (status === 'running' && compact) {
    // At this size only one thing is legible: the clock. The row beside the loupe names the stage.
    return label(queued ? 34 : 54, queued ? 96 : 160, queued ? 'queued' : elapsed ?? '0:00', 800);
  }
  if (status === 'running') {
    return (
      <>
        {label(-92, 48, name)}
        {label(46, queued ? 76 : 118, queued ? 'queued' : elapsed ?? '0:00', 800)}
        <text className="txt" x="0" y="118" textAnchor="middle" fontSize="38" fontWeight="500" fill="#dfe6e3">
          {queued ? 'waiting for the worker' : attempt > 1 ? `attempt ${attempt}` : 'running'}
        </text>
      </>
    );
  }
  const passed = status === 'needs_approval';
  return (
    <>
      {label(-118, 44, name, 600, 0.8)}
      {passed ? <path d={ringPath(0, 6, 178, 86, { seed: 12, start: Math.PI * 0.9 })} {...pencil} /> : <path d={crossPath(0, 6, 300, 170, 3)} {...pencil} />}
      <text className="disp" x="0" y="34" textAnchor="middle" fontSize="78" fontWeight="800" fill="#eef3f1" letterSpacing="-2" stroke="#2a3f38" strokeWidth={passed ? 0 : 12} strokeLinejoin="round" paintOrder="stroke">
        {passed ? 'ready' : status}
      </text>
    </>
  );
}

function footOf(state: StageState, row: StageInfo | undefined, ended: boolean): string {
  if (state === 'done') {
    const took = seconds(row?.startedAt ?? null, row?.endedAt ?? null);
    return took === null ? 'done' : `done ${clock(took)}`;
  }
  if (state === 'running') return ended ? 'stopped' : 'running';
  if (state === 'failed') return row && row.attempt > 1 ? `failed, attempt ${row.attempt}` : 'failed';
  return ended ? 'not run' : 'waiting';
}

function GatePanel({ frames, runId, status }: { frames: GateFrame[]; runId: string; status: RunStatus }) {
  const ended = status !== 'running';
  const summary = gateSummary(frames, ended);
  return (
    <section className={styles.gate} aria-label="The gate">
      <h2 className={styles.h}>
        The gate <span>{summary.count}</span>
      </h2>
      <p className={styles.gateLine}>{summary.line}</p>
      <ol className={`${film.film} ${styles.checks}`}>
        {frames.map((frame, i) => (
          <li key={frame.key} className={`${film.frame} ${frame.state === 'pending' ? styles.unlit : film.lit} ${styles.check}`}>
            <div className={styles.checkHead}>
              <h3>
                {frame.state === 'pending' ? (
                  frame.title
                ) : (
                  <Penciled mark={frame.state === 'pass' ? 'ring' : 'cross'} seed={9 + i * 4} weight={3.6} roomy draw label={frame.state === 'pass' ? 'passed' : 'failed'}>
                    {frame.title}
                  </Penciled>
                )}
              </h3>
              <span className={styles.checkState}>{frame.state === 'pending' ? (ended ? 'not checked' : 'not checked yet') : frame.state === 'pass' ? 'passed' : 'failed'}</span>
            </div>
            {frame.blurb ? <p className={styles.blurb}>{frame.blurb}</p> : null}
            {frame.reasons.length > 0 ? (
              <ul className={styles.reasons}>
                {frame.reasons.map((reason, n) => (
                  <li key={n}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {status === 'needs_approval' ? (
        <p className={styles.gateNote}>
          Passing the gate does not publish anything. A person still has to <Link href={`/reel/${runId}`}>watch the reel and approve it</Link>.
        </p>
      ) : null}
    </section>
  );
}

const FEED_WORD: Record<FeedState, string> = { live: 'live', reconnecting: 'reconnecting', ended: 'ended' };

export function RunView({ initial }: { initial: { run: RunInfo; stages: StageInfo[] } }) {
  const { run, stages, events, gate, feed } = useRunFeed(initial);
  const running = run.status === 'running';
  const now = useNow(running);

  const states = stageStates(stages);
  const rows = new Map(stages.map((s) => [s.name, s]));
  const headline = runHeadline(run.status, states);
  const at = focusStage(run.status, states);
  const focus = states[at]!;
  const focusRow = rows.get(focus.name);
  const queued = running && states.every((s) => s.state === 'waiting');
  const stageClock = focus.state === 'running' && now ? clock(seconds(focusRow?.startedAt ?? null, now) ?? 0) : null;
  const runClock = running && now ? stamp(run.createdAt, now) : null;
  const frames = gateFrames(gate, run.budgetUsd);
  const grounded = states[4]!.state === 'done';
  const shown = events.slice(-LOG_SHOWN);
  const failedRow = stages.find((s) => s.status === 'failed');
  const lensProps = { name: focus.name, status: run.status, elapsed: stageClock, attempt: focusRow?.attempt ?? 0, queued };

  return (
    <div className={styles.page}>
      <TopBar
        repo={repoName(run.repoUrl)}
        window={windowLabel(run.since, run.until)}
        state={STATE_WORD[run.status]}
        clock={runClock}
        live={running}
      />

      <main>
        <div className={styles.lead}>
          <h2 className={styles.headline}>
            {headline.lead} <b>{headline.strong}</b>
          </h2>
          <dl className={styles.cost}>
            <dt>{running ? 'Cost so far' : 'Cost'}</dt>
            <dd>
              <span>{formatCost(run.costUsd, run.budgetUsd)}</span>
              <Meter spent={run.costUsd} budget={run.budgetUsd} hole={11} height={17} gap={6} />
            </dd>
          </dl>
        </div>

        {!running ? (
          <div className={styles.outcome} role="status">
            {run.status === 'needs_approval' ? (
              <>
                <p>All nine stages are done and the gate let the reel through.</p>
                <Link className={`${pill.btn} ${pill.go}`} href={`/reel/${run.id}`}>Watch the reel</Link>
              </>
            ) : (
              <>
                <p>
                  <b>{run.status === 'blocked' ? 'Blocked.' : `Failed at ${focus.name}.`}</b>{' '}
                  {run.status === 'failed' && failedRow?.error
                    ? reasonInWords(failedRow.error)
                    : frames.some((f) => f.state === 'fail')
                      ? gateSummary(frames, true).line
                      : reasonInWords(run.reason)}
                </p>
                {grounded ? <Link className={pill.btn} href={`/reel/${run.id}`}>See the cut and its sources</Link> : null}
                <Link className={pill.btn} href="/">Start another run</Link>
              </>
            )}
          </div>
        ) : null}

        <div className={styles.rail}>
          <div className={styles.strip} style={{ '--at': at } as React.CSSProperties}>
            <div className={styles.inner}>
            <ol className={styles.stages} aria-label="The nine stages of the run">
              {states.map((stage, i) => {
                const row = rows.get(stage.name);
                const note = stage.state === 'failed' ? row?.error ?? null : stage.state === 'done' ? stageNote(events, stage.name) : null;
                return (
                  <li key={stage.name} className={`${styles.stage} ${styles[stage.state]}`} aria-current={i === at ? 'step' : undefined}>
                    <span className={styles.num}>{i + 1}</span>
                    <span className={styles.name}>{stage.name}</span>
                    <span className={styles.note}>{note}</span>
                    <span className={styles.foot}>{footOf(stage.state, row, !running)}</span>
                  </li>
                );
              })}
            </ol>
            <span className={styles.spill} aria-hidden="true" />
            {/* The same loupe twice: with its knurling and engraving where it is large, plain where it is small. */}
            <Loupe className={`${styles.glass} ${styles.wide}`}><StageLens {...lensProps} /></Loupe>
            <Loupe small className={`${styles.glass} ${styles.narrow}`}><StageLens {...lensProps} compact /></Loupe>
            </div>
          </div>
        </div>

        <div className={styles.below}>
          <section aria-label="Event log">
            <h2 className={styles.h}>
              Event log{' '}
              <span className={styles.feed}>
                <i className={feed === 'live' && running ? styles.pulse : undefined} />
                {running ? FEED_WORD[feed] : 'ended'}
              </span>
            </h2>
            {events.length > shown.length ? <p className={styles.earlier}>{events.length - shown.length} earlier events are not shown.</p> : null}
            {events.length === 0 ? (
              <p className={styles.quiet}>
                {queued ? 'Nothing yet. The worker takes one run at a time; this one starts when it is free.' : running ? 'Nothing logged yet.' : 'This run logged no events.'}
              </p>
            ) : (
              <ol className={styles.log} aria-live="polite" aria-relevant="additions">
                {shown.map((event, i) => (
                  <li key={event.id} className={running && i === shown.length - 1 ? styles.latest : undefined}>
                    <time dateTime={event.ts}>{stamp(run.createdAt, event.ts)}</time>
                    <span className={styles.who}>{event.stage ?? 'run'}</span>
                    <p>{event.message}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <GatePanel frames={frames} runId={run.id} status={run.status} />
        </div>
      </main>
    </div>
  );
}
