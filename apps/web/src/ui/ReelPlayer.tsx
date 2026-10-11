'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { LineTiming, Scene, Storyboard } from '@dailies/core';
import { clock } from './format';
import { LensText } from './LensText';
import { Loupe } from './Loupe';
import { Mark } from './Mark';
import { lineAt, markFor } from './model';
import { AUDIO_OFFSET_SEC, decisive, srtToVtt, type NarrationLine, type SceneSpan } from './reel-model';
import pill from './pill.module.css';
import styles from './ReelPlayer.module.css';

export interface ReelPlayerHandle {
  /** Cue the reel to a moment without starting it. */
  seek(sec: number): void;
}

export interface ReelPlayerProps {
  video: string | null;
  poster: string | null;
  subtitles: string | null;
  storyboard: Storyboard;
  lines: NarrationLine[];
  /** Narration time, as the voice stage wrote it. */
  timings: LineTiming[] | null;
  spans: SceneSpan[] | null;
  /** The line the page is on. The player follows it when it has no video to follow. */
  activeLineId: string | null;
  /** Called when playback or a seek lands on another line, or leaves the narration (null). */
  onLine(lineId: string | null): void;
  /** What sits under the glass for the active line when there is no video to show. */
  lensFocus?: { focus: string; face: 'code' | 'disp' } | null;
}

const KIND_WORD: Record<Scene['type'], string> = {
  title: 'Title',
  prompt: 'Request',
  terminal: 'Commands',
  diff: 'Patch',
  stats: 'Numbers',
  flag: 'Flag',
  end: 'Tally',
};

/** The one thing a scene's frame on the strip says. */
function frameGlyph(scene: Scene): string {
  if (scene.type === 'title') return scene.repo.split('/').at(-1) ?? scene.repo;
  if (scene.type === 'prompt') return '“ ”';
  if (scene.type === 'terminal') {
    const last = scene.steps.at(-1)!;
    return decisive(last.output) ?? (last.ok ? 'ran' : 'failed');
  }
  if (scene.type === 'diff') return `+${scene.added} −${scene.removed}`;
  if (scene.type === 'stats') return scene.items[0]?.value ?? '';
  return '';
}

/**
 * The reel and the strip it was cut from. The video is the picture; the strip under it is the same reel
 * as its scenes, with a loupe riding along at the playhead. Whichever line is being spoken is reported
 * upwards, so the narration and its sources can follow.
 */
export const ReelPlayer = forwardRef<ReelPlayerHandle, ReelPlayerProps>(function ReelPlayer(
  { video, poster, subtitles, storyboard, lines, timings, spans, activeLineId, onLine, lensFocus },
  ref,
) {
  const el = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(false);
  const [vtt, setVtt] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  const hasVideo = !!video && !broken;
  const planned = spans?.at(-1)?.endSec ?? null;
  const duration = mediaDuration ?? planned ?? 0;
  const activeLine = lines.find((l) => l.id === activeLineId) ?? null;

  // The renderer writes SubRip; fetch it once and hand the track a WebVTT blob.
  useEffect(() => {
    if (!subtitles || !hasVideo) return;
    let url: string | null = null;
    let live = true;
    fetch(subtitles)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((srt) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([srtToVtt(srt)], { type: 'text/vtt' }));
        setVtt(url);
      })
      .catch(() => setVtt(null));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [subtitles, hasVideo]);

  useEffect(() => {
    const track = el.current?.textTracks[0];
    if (track) track.mode = captions ? 'showing' : 'hidden';
  }, [captions, vtt]);

  const lastLine = useRef<string | null>(null);
  const report = useCallback(
    (sec: number) => {
      const id = timings ? lineAt(timings, sec, AUDIO_OFFSET_SEC) : null;
      if (id !== lastLine.current) {
        lastLine.current = id;
        onLine(id);
      }
    },
    [timings, onLine],
  );

  const seek = useCallback(
    (sec: number) => {
      const t = Math.max(0, Math.min(sec, duration || sec));
      if (el.current && hasVideo) {
        // Nudge past the cut so the frame shown belongs to the scene that starts here.
        el.current.currentTime = t + 0.05;
        setStarted(true);
      }
      setTime(t);
      report(t + 0.05);
    },
    [duration, hasVideo, report],
  );

  useImperativeHandle(ref, () => ({ seek }), [seek]);

  function toggle() {
    const v = el.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }

  const at = duration > 0 ? Math.min(time / duration, 1) : 0;
  const currentSpan = spans?.find((s) => time >= s.startSec && time < s.endSec) ?? null;
  const currentSceneId = currentSpan?.sceneId ?? activeLine?.sceneId ?? storyboard.scenes[0]?.id ?? null;
  const frames = spans
    ? spans.flatMap((s) => {
        const scene = storyboard.scenes.find((sc) => sc.id === s.sceneId);
        return scene ? [{ scene, weight: Math.max(s.endSec - s.startSec, 0.1) }] : [];
      })
    : storyboard.scenes.map((scene) => ({ scene, weight: 1 }));
  const where = currentSceneId ? KIND_WORD[storyboard.scenes.find((s) => s.id === currentSceneId)?.type ?? 'title'] : '';
  const total = clock(duration);

  return (
    <div className={styles.player}>
      <div className={styles.screen}>
        {hasVideo ? (
          <>
            {/* Captions come from the track below once the subtitle file has loaded. */}
            <video
              ref={el}
              src={video!}
              poster={poster ?? undefined}
              preload="metadata"
              playsInline
              muted={muted}
              onClick={toggle}
              onLoadedMetadata={(e) => setMediaDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
              onTimeUpdate={(e) => {
                setTime(e.currentTarget.currentTime);
                report(e.currentTarget.currentTime);
              }}
              onPlay={() => {
                setPlaying(true);
                setStarted(true);
              }}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onError={() => setBroken(true)}
            >
              {vtt ? <track kind="subtitles" src={vtt} srcLang="en" label="Narration" default /> : null}
            </video>
            {/* Before the first play only. Once a line is cued, nothing covers the frame it is cued to. */}
            {!playing && !started ? (
              <button type="button" className={styles.play} onClick={toggle} aria-label={`Play the reel, ${total}`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r="56" fill="rgba(7,10,9,.55)" stroke="#eef3f1" strokeOpacity=".85" strokeWidth="3" />
                  <path d="M48,36 L88,60 L48,84Z" fill="#eef3f1" stroke="#eef3f1" strokeWidth="7" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
          </>
        ) : (
          <div className={styles.still}>
            <Loupe className={styles.stillLoupe}>
              {lensFocus ? <LensText focus={lensFocus.focus} face={lensFocus.face} mark={activeLine?.mark ?? 'ring'} /> : null}
            </Loupe>
            <div className={styles.stillText}>
              <p className={styles.stillKind}>{activeLine ? `${KIND_WORD[activeLine.sceneType]}${activeLine.startSec !== null ? `, ${clock(activeLine.startSec)}` : ''}` : storyboard.repo}</p>
              <p className={styles.stillLine}>{activeLine ? activeLine.text : 'Pick a line to put it under the glass.'}</p>
              <p className={styles.stillNote}>{video ? 'The video could not be loaded.' : 'This run has no rendered video yet.'} These are the lines it was cut from.</p>
            </div>
          </div>
        )}
      </div>

      <div className={styles.scrub}>
        <div className={styles.stripWrap}>
          <ol className={styles.strip} aria-hidden="true">
            {frames.map(({ scene, weight }) => (
              <li key={scene.id} className={`${styles.frame} ${scene.id === currentSceneId ? styles.on : ''}`} style={{ flexGrow: weight }}>
                <span className={styles.kind}>{KIND_WORD[scene.type]}</span>
                {scene.type === 'flag' ? (
                  <Mark kind={markFor(scene.verdict)} size={20} weight={6} label={null} />
                ) : scene.type === 'end' ? (
                  <span className={styles.tally}>
                    {scene.verified}
                    <Mark kind="ring" size={13} weight={7} label={null} />
                    {scene.flagged}
                    <Mark kind="cross" size={13} weight={7} label={null} />
                  </span>
                ) : (
                  <span className={styles.glyph}>{frameGlyph(scene)}</span>
                )}
              </li>
            ))}
          </ol>
          {duration > 0 ? (
            <>
              <Loupe small clear className={styles.head} style={{ '--at': at } as React.CSSProperties} />
              <input
                className={styles.range}
                type="range"
                min={0}
                max={Math.ceil(duration)}
                step={1}
                value={Math.round(time)}
                aria-label="Position in the reel"
                aria-valuetext={`${clock(time)} of ${total}, ${where}`}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </>
          ) : null}
        </div>

        <div className={styles.controls}>
          {hasVideo ? (
            <button type="button" className={`${pill.btn} ${styles.ctl}`} onClick={toggle}>
              {playing ? 'Pause' : 'Play'}
            </button>
          ) : null}
          <span className={styles.clock}>
            <b>{clock(time)}</b> of {total}
          </span>
          <span className={styles.spacer} />
          {hasVideo && vtt ? (
            <button type="button" className={`${pill.btn} ${styles.ctl}`} aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>
              Captions {captions ? 'on' : 'off'}
            </button>
          ) : null}
          {hasVideo ? (
            <button type="button" className={`${pill.btn} ${styles.ctl}`} aria-pressed={!muted} onClick={() => setMuted((m) => !m)}>
              Sound {muted ? 'off' : 'on'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});
