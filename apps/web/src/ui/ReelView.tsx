'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clock, repoName, shortDate, windowLabel } from './format';
import { LensText } from './LensText';
import { Loupe } from './Loupe';
import { Mark, MARK_WORDS } from './Mark';
import { Meter } from './Meter';
import { evidenceHref, formatCost } from './model';
import { OwnerDialog, type OwnerAction } from './OwnerDialog';
import { ReelPlayer, type ReelPlayerHandle } from './ReelPlayer';
import { AUDIO_OFFSET_SEC, claimCounts, flagRows, lensOf, narrationLines, resolveSource, sceneSpans } from './reel-model';
import { SourceFrames } from './SourceFrames';
import { TopBar } from './TopBar';
import type { ReelData } from './types';
import film from './film.module.css';
import pill from './pill.module.css';
import styles from './ReelView.module.css';

const UNSETTLED_SHOWN = 4;

export function ReelView({ data }: { data: ReelData }) {
  const { run, storyboard, claims, timings, media } = data;
  const player = useRef<ReelPlayerHandle>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const list = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => (storyboard ? narrationLines(storyboard, timings, AUDIO_OFFSET_SEC) : []), [storyboard, timings]);
  const spans = useMemo(() => (storyboard ? sceneSpans(storyboard, timings, AUDIO_OFFSET_SEC) : null), [storyboard, timings]);
  const sources = useMemo(() => {
    const ctx = { storyboard: storyboard!, claims };
    return new Map(lines.map((l) => [l.id, l.evidence.map((ref) => resolveSource(ref, ctx))]));
  }, [lines, storyboard, claims]);
  const flags = useMemo(() => flagRows(claims, storyboard), [claims, storyboard]);
  const counts = useMemo(() => claimCounts(claims), [claims]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [glassY, setGlassY] = useState<number | null>(null);
  const [reel, setReel] = useState(data.reel);
  const [runStatus, setRunStatus] = useState(run.status);
  const [action, setAction] = useState<OwnerAction | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; follow: boolean } | null>(null);
  const [allUnsettled, setAllUnsettled] = useState(false);
  const [justApproved, setJustApproved] = useState(false);

  // Playback moved to another line: the glass follows it. A pause between lines keeps the last one.
  const onLine = useCallback((id: string | null) => {
    if (id) {
      setActiveId(id);
      setOpen(true);
    }
  }, []);

  function pick(id: string, startSec: number | null) {
    if (id === activeId && open) {
      setOpen(false);
      return;
    }
    setActiveId(id);
    setOpen(true);
    if (startSec !== null) player.current?.seek(startSec);
  }

  // Where the open line sits in the list, so the loupe can glide to it.
  useLayoutEffect(() => {
    const row = activeId && open ? rows.current.get(activeId) : null;
    setGlassY(row ? row.offsetTop : null);
  }, [activeId, open]);

  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const row = activeId && open ? rows.current.get(activeId) : null;
      if (row) setGlassY(row.offsetTop);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeId, open]);

  const activeSources = activeId ? sources.get(activeId) ?? [] : [];
  const activeLine = lines.find((l) => l.id === activeId) ?? null;
  const lens = lensOf(activeSources);
  const duration = spans?.at(-1)?.endSec ?? null;
  const title = storyboard?.scenes[0]?.type === 'title' ? storyboard.scenes[0] : null;
  const approved = reel.status === 'approved';
  const canApprove = runStatus === 'needs_approval' && !approved;

  const state =
    runStatus === 'running'
      ? 'Cutting again'
      : approved
        ? justApproved
          ? 'Approved just now'
          : `Approved ${reel.approvedAt ? shortDate(reel.approvedAt) : ''}`.trim()
        : runStatus === 'needs_approval'
          ? 'Waiting for your review'
          : runStatus === 'blocked'
            ? 'Blocked before approval'
            : 'The run failed';

  const settled = flags.filter((f) => f.verdict !== 'unverifiable');
  const unsettled = flags.filter((f) => f.verdict === 'unverifiable');
  const shownUnsettled = allUnsettled ? unsettled : unsettled.slice(0, UNSETTLED_SHOWN);

  return (
    <div className={styles.page}>
      <TopBar repo={storyboard?.repo ?? repoName(run.repoUrl)} window={title?.windowLabel ?? windowLabel(run.since, run.until)} state={state} live={runStatus === 'running'} />

      {storyboard ? (
        <main className={styles.grid}>
          <section className={styles.watch} aria-label="The reel">
            <ReelPlayer
              ref={player}
              video={media.video}
              poster={media.poster}
              subtitles={media.subtitles}
              storyboard={storyboard}
              lines={lines}
              timings={timings}
              spans={spans}
              activeLineId={activeId}
              onLine={onLine}
              lensFocus={lens}
            />
            <p className={styles.now}>
              {activeLine ? (
                <>
                  <span className={styles.nowTime}>{activeLine.startSec !== null ? clock(activeLine.startSec) : ''}</span>
                  <span>{activeLine.text}</span>
                </>
              ) : (
                <span className={styles.nowIdle}>Play the reel, or pick a line, and its sources open beside it.</span>
              )}
            </p>
          </section>

          <section className={styles.narr} aria-label="Narration and its sources">
            <h2 className={styles.h}>
              Narration <span>{lines.length} {lines.length === 1 ? 'line' : 'lines'}, each opens to its sources</span>
            </h2>
            {lines.length === 0 ? <p className={styles.empty}>No narration line survived the grounding stage.</p> : null}
            <div className={styles.rowsWrap} ref={list}>
            <ol className={styles.rows}>
              {lines.map((line, i) => {
                const isOpen = open && line.id === activeId;
                const own = sources.get(line.id) ?? [];
                return (
                  <li
                    key={line.id}
                    className={`${styles.row} ${isOpen ? styles.open : ''}`}
                    ref={(node) => {
                      if (node) rows.current.set(line.id, node);
                      else rows.current.delete(line.id);
                    }}
                  >
                    <button
                      type="button"
                      className={styles.summary}
                      aria-expanded={isOpen}
                      aria-controls={`src-${line.id}`}
                      aria-current={line.id === activeId ? 'true' : undefined}
                      onClick={() => pick(line.id, line.startSec)}
                    >
                      <span className={styles.t}>{line.startSec !== null ? clock(line.startSec) : `${i + 1}`}</span>
                      <span className={styles.x}>{line.text}</span>
                      <span className={styles.n}>{own.length} {own.length === 1 ? 'source' : 'sources'}</span>
                      {/* The mark gives way to the loupe when the row opens, so its meaning is also written out. */}
                      <Mark kind={line.mark} size={26} seed={3 + i} label={null} className={styles.rowMark} />
                      <span className="sr">{MARK_WORDS[line.mark]}</span>
                    </button>
                    <div id={`src-${line.id}`} className={`${film.film} ${styles.ev}`} hidden={!isOpen}>
                      {isOpen ? (
                        <SourceFrames sources={own} mark={line.mark} hrefFor={(s) => (s.kind === 'diff' ? evidenceHref({ type: 'diff', sha: s.sha, path: s.path }, run.repoUrl) : null)} />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
              {glassY !== null && lens && activeLine ? (
                <div className={styles.glass} style={{ transform: `translateY(${glassY}px)` }} aria-hidden="true">
                  <Loupe small>
                    <LensText key={activeLine.id} focus={lens.focus} face={lens.face} mark={activeLine.mark} seed={4} draw />
                  </Loupe>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.flags} aria-label="Flags">
            <h2 className={styles.h}>
              Flags <span>{settled.length} flagged and {unsettled.length} unverified, of {counts.total} {counts.total === 1 ? 'claim' : 'claims'}</span>
            </h2>
            {flags.length === 0 ? (
              <p className={styles.empty}>
                {counts.total === 0 ? 'The agents made no claim that could be checked.' : `All ${counts.total} claims the agents made are backed by the record.`}
              </p>
            ) : null}
            <ul className={styles.flagList}>
              {settled.map((flag, i) => (
                <li key={flag.id} className={styles.flag}>
                  <Mark kind={flag.mark} size={46} weight={5} seed={5 + i} label={null} />
                  <div>
                    <p className={styles.said}>“{flag.quote}”</p>
                    <p className={styles.rec}>{flag.reality ?? 'The record does not say why.'}</p>
                  </div>
                  <div className={styles.side}>
                    <span className={`${styles.verdict} ${styles.solid}`}>{MARK_WORDS[flag.mark].toUpperCase()}</span>
                    <span className={styles.where}>{flag.where}</span>
                  </div>
                </li>
              ))}
              {shownUnsettled.map((flag) => (
                <li key={flag.id} className={`${styles.flag} ${styles.minor}`}>
                  <Mark kind="question" size={34} weight={5} label={null} />
                  <div>
                    <p className={styles.said}>“{flag.quote}”</p>
                    <p className={styles.rec}>{flag.reality ?? 'Nothing in the record settles it either way.'}</p>
                  </div>
                  <div className={styles.side}>
                    <span className={`${styles.verdict} ${styles.outline}`}>UNVERIFIED</span>
                    <span className={styles.where}>{flag.where}</span>
                  </div>
                </li>
              ))}
            </ul>
            {unsettled.length > shownUnsettled.length ? (
              <button type="button" className={`${pill.btn} ${pill.quiet} ${styles.moreFlags}`} onClick={() => setAllUnsettled(true)}>
                Show {unsettled.length - shownUnsettled.length} more unverified
              </button>
            ) : null}
          </section>
        </main>
      ) : (
        <main className={styles.unreadable}>
          <h2>The storyboard of this run cannot be read.</h2>
          <p>The script stage wrote something this page does not recognise, so there is no narration to show. The run itself is listed below.</p>
        </main>
      )}

      <footer className={styles.bar}>
        <dl className={styles.facts}>
          <div>
            <dt>Duration</dt>
            <dd>{duration !== null ? clock(duration) : 'not timed yet'}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>
              <span>{formatCost(run.costUsd, run.budgetUsd)}</span>
              <Meter spent={run.costUsd} budget={run.budgetUsd} />
            </dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd className={styles.id}><Link href={`/r/${run.id}`}>{run.id}</Link></dd>
          </div>
        </dl>
        <div className={styles.acts}>
          <button type="button" className={pill.btn} onClick={() => setAction('changes')}>Request changes</button>
          <button type="button" className={`${pill.btn} ${pill.go}`} disabled={!canApprove} onClick={() => setAction('approve')}>
            {approved ? 'Approved' : 'Approve'}
          </button>
        </div>
        <p className={styles.outcome} role="status">
          {outcome ? (
            <>
              {outcome.text} {outcome.follow ? <Link href={`/r/${run.id}`}>Follow the run</Link> : null}
            </>
          ) : !canApprove && !approved ? (
            runStatus === 'running' ? 'This run is being cut again, so it cannot be approved yet.' : 'Only a run that passed the gate can be approved.'
          ) : null}
        </p>
      </footer>

      <OwnerDialog
        runId={run.id}
        action={action}
        onClose={() => setAction(null)}
        onApproved={(approvedAt) => {
          setReel({ runId: run.id, status: 'approved', approvedAt });
          setJustApproved(true);
          setOutcome({ text: 'Approved. The reel is in the gallery.', follow: false });
        }}
        onChanges={(recut, withToken) => {
          if (recut) setRunStatus('running');
          setOutcome(
            recut
              ? { text: 'Changes requested. The run is cutting the reel again.', follow: true }
              : withToken
                ? { text: 'Changes requested and saved. The reel was not cut again: the token was not accepted, or the run is still going.', follow: false }
                : { text: 'Changes requested and saved. Without the owner token the reel is not cut again.', follow: false },
          );
        }}
      />
    </div>
  );
}
