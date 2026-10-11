import { describe, it, expect } from 'vitest';
import { Storyboard } from '@dailies/core';
import { buildTimeline, lineAt } from '../src/timeline';
import { fixtureStoryboard, fixtureTimings, shortStoryboard } from './fixture';

const sb = fixtureStoryboard();
const timings = fixtureTimings();

describe('fixture', () => {
  it('is a valid storyboard with one scene of each type', () => {
    expect(Storyboard.parse(sb)).toEqual(sb);
    expect(sb.scenes.map((s) => s.type)).toEqual(['title', 'prompt', 'terminal', 'diff', 'stats', 'flag', 'end']);
  });
});

describe('buildTimeline', () => {
  it('places the title before the audio and keeps scenes contiguous', () => {
    const tl = buildTimeline(sb, timings);
    expect(tl.audioStartFrame).toBe(75);
    expect(tl.scenes[0]).toMatchObject({ startFrame: 0, durationInFrames: 75 });
    for (let i = 1; i < tl.scenes.length; i++) expect(tl.scenes[i]!.startFrame).toBe(tl.scenes[i - 1]!.startFrame + tl.scenes[i - 1]!.durationInFrames);
    expect(tl.totalFrames).toBe(tl.scenes.reduce((n, s) => n + s.durationInFrames, 0));
  });

  it('gives the end scene 90 frames', () => {
    expect(buildTimeline(sb, timings).scenes.at(-1)).toEqual({ sceneId: 'sc_end', startFrame: 825, durationInFrames: 90 });
  });

  it('cuts each spoken scene at the first line of the next one', () => {
    expect(buildTimeline(sb, timings)).toEqual({
      fps: 30,
      totalFrames: 915,
      audioStartFrame: 75,
      scenes: [
        { sceneId: 'sc_title', startFrame: 0, durationInFrames: 75 },
        { sceneId: 'sc_prompt', startFrame: 75, durationInFrames: 108 },     // l1 starts at 0 s, l2 at 3.6 s
        { sceneId: 'sc_terminal', startFrame: 183, durationInFrames: 198 },  // l4 starts at 10.2 s
        { sceneId: 'sc_diff', startFrame: 381, durationInFrames: 114 },      // l5 starts at 14 s
        { sceneId: 'sc_stats', startFrame: 495, durationInFrames: 105 },     // l6 starts at 17.5 s
        { sceneId: 'sc_flag', startFrame: 600, durationInFrames: 225 },      // l7 ends at 24.6 s, plus 0.4 s
        { sceneId: 'sc_end', startFrame: 825, durationInFrames: 90 },
      ],
    });
  });

  it('holds the last spoken scene 0.4 s past its last line', () => {
    const tl = buildTimeline(shortStoryboard(), [{ lineId: 'l1', startSec: 0, endSec: 2 }]);
    expect(tl.scenes[1]).toEqual({ sceneId: 'sc_prompt', startFrame: 75, durationInFrames: 72 });
    expect(tl.totalFrames).toBe(75 + 72 + 90);
  });

  it('leaves the pause after a line to the scene that spoke it', () => {
    const gapped = timings.map((t) => (t.lineId === 'l1' ? { ...t, endSec: 3 } : t));
    expect(buildTimeline(sb, gapped).scenes[1]).toEqual({ sceneId: 'sc_prompt', startFrame: 75, durationInFrames: 108 });
  });

  it('starts the first spoken scene right after the title when the narration opens with silence', () => {
    const late = timings.map((t) => (t.lineId === 'l1' ? { ...t, startSec: 0.5 } : t));
    const tl = buildTimeline(sb, late);
    expect(tl.audioStartFrame).toBe(75);
    expect(tl.scenes[1]).toEqual({ sceneId: 'sc_prompt', startFrame: 75, durationInFrames: 108 });
  });

  it('does not depend on the order of the timings array', () => {
    expect(buildTimeline(sb, [...timings].reverse())).toEqual(buildTimeline(sb, timings));
  });

  it('scales every duration with the frame rate', () => {
    const tl = buildTimeline(sb, timings, 60);
    expect(tl).toMatchObject({ fps: 60, audioStartFrame: 150, totalFrames: 1830 });
    expect(tl.scenes.at(-1)).toEqual({ sceneId: 'sc_end', startFrame: 1650, durationInFrames: 180 });
  });

  it('handles a storyboard with no spoken scenes', () => {
    const bare = { ...sb, scenes: [sb.scenes[0]!, sb.scenes.at(-1)!] };
    expect(buildTimeline(bare, [])).toEqual({
      fps: 30,
      totalFrames: 165,
      audioStartFrame: 75,
      scenes: [
        { sceneId: 'sc_title', startFrame: 0, durationInFrames: 75 },
        { sceneId: 'sc_end', startFrame: 75, durationInFrames: 90 },
      ],
    });
  });

  it('never emits an empty scene when two scenes start at the same moment', () => {
    const collided = timings.map((t) => (t.lineId === 'l4' ? { ...t, startSec: 3.6 } : t));   // diff starts with terminal
    const tl = buildTimeline(sb, collided);
    expect(tl.scenes[2]).toEqual({ sceneId: 'sc_terminal', startFrame: 183, durationInFrames: 1 });
    expect(tl.scenes[3]).toEqual({ sceneId: 'sc_diff', startFrame: 184, durationInFrames: 311 });
    expect(tl.scenes.every((s) => s.durationInFrames >= 1)).toBe(true);
    expect(tl.totalFrames).toBe(915);
  });

  it('throws when a line has no timing', () => {
    expect(() => buildTimeline(sb, timings.filter((t) => t.lineId !== 'l4'))).toThrow(/no timing for line l4/);
  });

  it('throws when the storyboard is not a title, spoken scenes and an end', () => {
    const noTitle = { ...sb, scenes: sb.scenes.slice(1) };
    const noEnd = { ...sb, scenes: sb.scenes.slice(0, -1) };
    const titleInside = { ...sb, scenes: [sb.scenes[0]!, sb.scenes[1]!, sb.scenes[0]!, sb.scenes.at(-1)!] };
    expect(() => buildTimeline(noTitle, timings)).toThrow(/must start with a title scene/);
    expect(() => buildTimeline(noEnd, timings)).toThrow(/must finish with an end scene/);
    expect(() => buildTimeline(titleInside, timings)).toThrow(/scene 2 \(title\) cannot sit between spoken scenes/);
  });
});

describe('lineAt', () => {
  it('returns the line being spoken at a narration time', () => {
    expect(lineAt(sb, timings, 0)).toMatchObject({ id: 'l1', startSec: 0, endSec: 3.6 });
    expect(lineAt(sb, timings, 3.59)?.id).toBe('l1');
    expect(lineAt(sb, timings, 3.6)?.id).toBe('l2');
    expect(lineAt(sb, timings, 24.59)).toMatchObject({ id: 'l7', text: 'The last test run before that message had failed.' });
  });

  it('returns null before the narration, after it and inside a pause', () => {
    const gapped = timings.map((t) => (t.lineId === 'l1' ? { ...t, endSec: 3 } : t));
    expect(lineAt(sb, timings, -0.1)).toBeNull();
    expect(lineAt(sb, timings, 24.6)).toBeNull();
    expect(lineAt(sb, gapped, 3.3)).toBeNull();
  });
});
