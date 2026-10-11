import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { FPS, buildTimeline } from '../timeline';
import { Reel, type ReelProps } from './Reel';

export const COMPOSITION_ID = 'Reel';
export const WIDTH = 1920;
export const HEIGHT = 1080;

// What the Studio shows before real props arrive; a render always passes its own.
const preview: ReelProps = {
  storyboard: {
    runId: 'preview',
    repo: 'owner/repository',
    targetSec: 75,
    facts: {},
    scenes: [
      { id: 'title', type: 'title', lines: [], repo: 'owner/repository', windowLabel: 'Last 7 days', sessionCount: 0, commitCount: 0 },
      { id: 'end', type: 'end', lines: [], repo: 'owner/repository', verified: 0, flagged: 0 },
    ],
  },
  timings: [],
  audio: false,
};

const calculateMetadata: CalculateMetadataFunction<ReelProps> = ({ props }) => ({
  durationInFrames: buildTimeline(props.storyboard, props.timings, FPS).totalFrames,
});

export const Root: React.FC = () => (
  <Composition id={COMPOSITION_ID} component={Reel} width={WIDTH} height={HEIGHT} fps={FPS} defaultProps={preview} calculateMetadata={calculateMetadata} />
);
