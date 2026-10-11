'use client';

import { useCallback, useMemo, useState } from 'react';
import { clock } from './format';
import { ReelPlayer } from './ReelPlayer';
import { AUDIO_OFFSET_SEC, narrationLines, sceneSpans } from './reel-model';
import type { ReelData } from './types';
import styles from './SampleReel.module.css';

/** The reel player on its own, with the line being spoken written under it. */
export function SamplePlayer({ data }: { data: ReelData }) {
  const storyboard = data.storyboard!;
  const lines = useMemo(() => narrationLines(storyboard, data.timings, AUDIO_OFFSET_SEC, data.cues), [storyboard, data.timings, data.cues]);
  const spans = useMemo(() => sceneSpans(storyboard, data.timings, AUDIO_OFFSET_SEC), [storyboard, data.timings]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const onLine = useCallback((id: string | null) => {
    if (id) setActiveId(id);
  }, []);
  const line = lines.find((l) => l.id === activeId) ?? null;

  return (
    <div className={styles.player}>
      <ReelPlayer
        video={data.media.video}
        poster={data.media.poster}
        subtitles={data.media.subtitles}
        storyboard={storyboard}
        lines={lines}
        timings={data.timings}
        spans={spans}
        activeLineId={activeId}
        onLine={onLine}
      />
      <p className={styles.now}>
        {line ? (
          <>
            <span>{line.startSec !== null ? clock(line.startSec) : ''}</span>
            {line.text}
          </>
        ) : (
          <>
            <span />
            {storyboard.repo}, {lines.length} narrated lines
          </>
        )}
      </p>
    </div>
  );
}
