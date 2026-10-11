import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import type { LineTiming, Scene, Storyboard } from '@dailies/core';
import { HEIGHT, NARRATION_FILE, type ReelProps } from './config';
import { theme } from '../theme';
import { buildTimeline, lineAt } from '../timeline';
import { lineSpans, stepAt } from './cues';
import { Strip } from './Film';
import { framing, lensPath, shotOf, type Take } from './lens';
import { Loupe } from './Loupe';
import { PencilDefs } from './marks';
import { FACE, emOf } from './measure';
import { stripOf } from './strip';
import { LIMITS, boxRoom, clampEnd, fitText } from './text';
import { Lines, SceneContext, useFonts, type Clock } from './ui';
import { Diff } from './scenes/Diff';
import { End } from './scenes/End';
import { Flag } from './scenes/Flag';
import { Prompt } from './scenes/Prompt';
import { Stats } from './scenes/Stats';
import { Terminal } from './scenes/Terminal';
import { Title } from './scenes/Title';

const { color, size, leading, radius, space, layout, motion, film, loupe } = theme;

const BLUR_FROM = 0.75;          // px of blur below which content under the glass is left sharp
const OVER_PARALLAX = 0.25;      // how much of the film's travel the titles lying over it follow
const MAX_DRIFT = 40;            // px the picture may drift from where a scene rests

/** The three layers of a scene. */
function layers(scene: Scene): { film: React.ReactNode; glass: React.ReactNode; over: React.ReactNode } {
  switch (scene.type) {
    case 'title': return { film: <Title.Film scene={scene} />, glass: <Title.Glass scene={scene} />, over: Title.Over ? <Title.Over scene={scene} /> : null };
    case 'prompt': return { film: <Prompt.Film scene={scene} />, glass: <Prompt.Glass scene={scene} />, over: null };
    case 'terminal': return { film: <Terminal.Film scene={scene} />, glass: <Terminal.Glass scene={scene} />, over: null };
    case 'diff': return { film: <Diff.Film scene={scene} />, glass: <Diff.Glass scene={scene} />, over: null };
    case 'stats': return { film: <Stats.Film scene={scene} />, glass: <Stats.Glass scene={scene} />, over: null };
    case 'flag': return { film: <Flag.Film scene={scene} />, glass: <Flag.Glass scene={scene} />, over: Flag.Over ? <Flag.Over scene={scene} /> : null };
    case 'end': return { film: <End.Film scene={scene} />, glass: <End.Glass scene={scene} />, over: End.Over ? <End.Over scene={scene} /> : null };
  }
}

/** The line being spoken, in a bar across the inset every narrated scene keeps free for it. */
const CaptionBar: React.FC<{ storyboard: Storyboard; timings: LineTiming[]; audioStartFrame: number }> = ({ storyboard, timings, audioStartFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = lineAt(storyboard, timings, (frame - audioStartFrame) / fps);
  if (!line) return null;
  const type = { max: size.text.caption, min: size.text.caption, leading: leading.text };
  const width = layout.captionWidth - 2 * space.xl;
  const fitted = fitText(clampEnd(line.text.replace(/\s+/g, ' ').trim(), LIMITS.line), type, boxRoom(width, layout.captionLines * type.max * type.leading), emOf(FACE.body), { maxLines: layout.captionLines });
  const since = frame - (audioStartFrame + line.startSec * fps);
  const shown = interpolate(since, [0, motion.enterSec * fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: layout.captionBottom }}>
      <div style={{ padding: `${space.md}px ${space.xl}px`, background: layout.captionFill, border: `${film.edgeWidth}px solid ${layout.captionEdge}`, borderRadius: radius.bar, opacity: shown }}>
        <Lines fitted={fitted} face={FACE.body} leading={type.leading} align="center" />
      </div>
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({ storyboard, timings, audio, settled = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ready = useFonts();
  const captions = !audio;

  const plan = useMemo(() => {
    const timeline = buildTimeline(storyboard, timings, fps);
    const shots = storyboard.scenes.map((scene) => shotOf(scene, captions));
    const path = lensPath(timeline, storyboard, { captions });
    const spans = storyboard.scenes.map((scene, i) => lineSpans(scene, timings, timeline.scenes[i]!, timeline.audioStartFrame, fps));
    return { timeline, shots, path, spans };
  }, [storyboard, timings, fps, captions]);
  const { timeline, shots, path, spans } = plan;

  if (!ready) return null;

  const slot = (i: number) => timeline.scenes[i]!;
  // Where the lens is along a scene's own frames: its resting point, moved on by the steps a terminal has told so far.
  const focusAt = (at: number) => (i: number) =>
    shots[i]!.at + film.perforations * stepAt(storyboard.scenes[i]!, spans[i]!, at - slot(i).startFrame, slot(i).durationInFrames, fps, settled);
  const view = framing(path, shots, frame, focusAt(frame));

  // The picture drifts along the strip while a scene plays; across a glide one scene's drift hands over to the next.
  const driftOf = (i: number) => Math.max(-MAX_DRIFT, Math.min(MAX_DRIFT, (-motion.driftPerSec * (frame - slot(i).startFrame - slot(i).durationInFrames / 2)) / fps));
  const drift = driftOf(view.lens.from) + (driftOf(view.lens.to) - driftOf(view.lens.from)) * Math.max(0, Math.min(1, view.lens.progress));
  const lens = { ...view.lens, x: view.lens.x + drift };

  // Motion blur along the film, from how far it moved since the frame before.
  const before = framing(path, shots, frame - 1, focusAt(frame - 1));
  const perf = view.unit / film.perforations;
  const speed = Math.max(0, ...view.takes.map((take) => Math.abs(take.focus - (before.takes.find((t) => t.index === take.index)?.focus ?? take.focus)) * perf));
  const smear = speed * motion.shutter;

  const clock = (take: Take): Clock => {
    const scene = storyboard.scenes[take.index]!;
    const arrival = path.transitions[Math.max(0, take.index - 1)];
    return {
      frame: frame - slot(take.index).startFrame,
      duration: slot(take.index).durationInFrames,
      fps,
      landing: arrival ? arrival.end - arrival.cut : 0,
      lines: spans[take.index]!,
      shot: take.shot,
      bottom: captions && scene.lines.length > 0 ? HEIGHT - layout.captionInset : HEIGHT,
      settled,
    };
  };
  const drawn = view.takes.map((take) => ({ take, clock: clock(take), parts: layers(storyboard.scenes[take.index]!) }));

  return (
    <AbsoluteFill style={{ background: theme.backdrop(lens), color: color.white, overflow: 'hidden' }}>
      <PencilDefs />

      <div style={{ position: 'absolute', left: lens.x, top: lens.y, width: 0, height: 0 }}>
        <Strip view={view} lensX={lens.x} id="perforations" smear={smear}>
          {(take) => {
            const layer = drawn.find((d) => d.take.index === take.index)!;
            return <SceneContext.Provider value={layer.clock}>{layer.parts.film}</SceneContext.Provider>;
          }}
        </Strip>
      </div>
      <AbsoluteFill style={{ background: theme.spill(lens) }} />

      <Loupe
        lens={lens}
        transit={1 - Math.max(...view.takes.map((take) => take.presence))}
        skirt={<Strip view={view} lensX={lens.x} id="perforations-skirt" smear={smear} />}
        passing={<Strip view={{ ...view, unit: view.unit * loupe.passing.magnify }} lensX={lens.x} id="perforations-glass" smear={smear * loupe.passing.magnify} light="lit" />}
      >
        {drawn.map(({ take, clock: value, parts }) => {
          // What is under the glass grows with the lens, passes faster than the film does, and comes into focus as the lens lands.
          const passed = (take.shot.at - take.focus) * stripOf(take.shot.unit, take.shot.half).perf * loupe.parallax;
          const soft = (1 - take.presence) * loupe.focusBlur;
          return (
            <SceneContext.Provider key={take.index} value={value}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, opacity: take.presence, transform: `scale(${lens.scale / take.shot.lens.scale}) translateX(${passed}px)`, filter: soft > BLUR_FROM ? `blur(${soft}px)` : undefined }}>
                {parts.glass}
              </div>
            </SceneContext.Provider>
          );
        })}
      </Loupe>

      {drawn.map(({ take, clock: value, parts }) =>
        parts.over ? (
          <SceneContext.Provider key={take.index} value={value}>
            <AbsoluteFill style={{ opacity: take.presence, transform: `translateX(${drift + (take.shot.at - take.focus) * perf * OVER_PARALLAX}px)` }}>{parts.over}</AbsoluteFill>
          </SceneContext.Provider>
        ) : null,
      )}

      {audio ? (
        <Sequence name="narration" from={timeline.audioStartFrame} layout="none">
          <Audio src={staticFile(NARRATION_FILE)} />
        </Sequence>
      ) : (
        <CaptionBar storyboard={storyboard} timings={timings} audioStartFrame={timeline.audioStartFrame} />
      )}
    </AbsoluteFill>
  );
};
