import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import type { LineTiming, Scene, Storyboard } from '@dailies/core';
import { NARRATION_FILE, type ReelProps } from './config';
import { theme } from '../theme';
import { buildTimeline, lineAt } from '../timeline';
import { LIMITS, clampEnd, fitSize, textUnits } from './text';
import { ReelContext } from './ui';
import { Diff } from './scenes/Diff';
import { End } from './scenes/End';
import { Flag } from './scenes/Flag';
import { Prompt } from './scenes/Prompt';
import { Stats } from './scenes/Stats';
import { Terminal } from './scenes/Terminal';
import { Title } from './scenes/Title';

const { color, font, size, weight, leading, radius, space, stroke, layout, motion } = theme;

const SceneView: React.FC<{ scene: Scene }> = ({ scene }) => {
  switch (scene.type) {
    case 'title': return <Title scene={scene} />;
    case 'prompt': return <Prompt scene={scene} />;
    case 'terminal': return <Terminal scene={scene} />;
    case 'diff': return <Diff scene={scene} />;
    case 'stats': return <Stats scene={scene} />;
    case 'flag': return <Flag scene={scene} />;
    case 'end': return <End scene={scene} />;
  }
};

/** The line being spoken, drawn as a bar in the inset every scene keeps free for it. */
const CaptionBar: React.FC<{ storyboard: Storyboard; timings: LineTiming[]; audioStartFrame: number }> = ({ storyboard, timings, audioStartFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = lineAt(storyboard, timings, (frame - audioStartFrame) / fps);
  if (!line) return null;
  const text = clampEnd(line.text, LIMITS.line);
  // The scenes keep room for three lines at the caption size; a longer line is set smaller rather than taller.
  const room = { width: layout.captionWidth - 2 * space.lg, height: 3 * size.caption * leading.text };
  const fontSize = fitSize(textUnits(text), room, { max: size.caption, min: size.label, advance: theme.advance.text, leading: leading.text });
  const since = frame - (audioStartFrame + line.startSec * fps);
  const shown = interpolate(since, [0, motion.enterSec * fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: layout.captionBottom }}>
      <div
        style={{
          maxWidth: layout.captionWidth,
          padding: `${space.sm}px ${space.lg}px`,
          background: color.panel,
          border: `${stroke.hair}px solid ${color.edge}`,
          borderRadius: radius.md,
          color: color.text,
          fontFamily: font.text,
          fontSize,
          fontWeight: weight.medium,
          lineHeight: leading.text,
          textAlign: 'center',
          opacity: shown,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end' }}>
      <div style={{ height: layout.progress, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, background: color.accent }} />
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({ storyboard, timings, audio }) => {
  const { fps } = useVideoConfig();
  const timeline = useMemo(() => buildTimeline(storyboard, timings, fps), [storyboard, timings, fps]);
  const context = useMemo(() => ({ repo: storyboard.repo, captions: !audio }), [storyboard.repo, audio]);
  return (
    <ReelContext.Provider value={context}>
      <AbsoluteFill style={{ background: theme.backdrop }}>
        {timeline.scenes.map((slot, i) => (
          <Sequence key={i} name={slot.sceneId} from={slot.startFrame} durationInFrames={slot.durationInFrames} premountFor={fps}>
            <SceneView scene={storyboard.scenes[i]!} />
          </Sequence>
        ))}
        {audio ? (
          <Sequence name="narration" from={timeline.audioStartFrame} layout="none">
            <Audio src={staticFile(NARRATION_FILE)} />
          </Sequence>
        ) : (
          <CaptionBar storyboard={storyboard} timings={timings} audioStartFrame={timeline.audioStartFrame} />
        )}
        <Progress />
      </AbsoluteFill>
    </ReelContext.Provider>
  );
};
