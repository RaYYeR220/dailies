import { describe, it, expect } from 'vitest';
import { Storyboard, type Scene } from '@dailies/core';
import { HEIGHT } from '../src/remotion/config';
import { shotOf } from '../src/remotion/lens';
import { frameBox, stripOf } from '../src/remotion/strip';
import { LIMITS, PROMPT_SHOWN, abbreviate, boxRoom } from '../src/remotion/text';
import { ROLES, widthOf } from '../src/remotion/ui';
import { layoutPrompt } from '../src/remotion/scenes/Prompt';
import { fitRow } from '../src/remotion/scenes/Stats';
import { theme } from '../src/theme';
import { realStoryboard, stressStoryboard } from './fixture';

// Outside a browser type is measured by estimate, which is enough to pin how a scene lays its text out.
const { floor, layout, loupe, shot, space } = theme;

type SceneOf<T extends Scene['type']> = Extract<Scene, { type: T }>;
const sceneOf = <T extends Scene['type']>(sb: Storyboard, type: T) => sb.scenes.find((s): s is SceneOf<T> => s.type === type)!;

describe('the real fixture', () => {
  it('is a storyboard the schema takes, with the request near its limit and a four-digit stat', () => {
    const sb = realStoryboard();
    expect(Storyboard.parse(sb)).toEqual(sb);
    const quote = sceneOf(sb, 'prompt').quote;
    expect(quote.length).toBeGreaterThan(260);
    expect(quote.length).toBeLessThanOrEqual(LIMITS.promptQuote);
    expect(sceneOf(sb, 'stats').items.map((item) => item.value)).toContain('1493');
  });
});

describe('the stats row', () => {
  /** The values that take a frame each, and the room one of those frames has for its value. */
  const row = (sb: Storyboard) => {
    const scene = sceneOf(sb, 'stats');
    const rest = shotOf(scene, true);
    const box = frameBox(stripOf(rest.unit, rest.half), rest.at, 1);
    const values = scene.items.slice(1).map((item) => item.value);
    return { values, width: box.width - 2 * space.sm, fitted: fitRow(values, boxRoom(box.width - 2 * space.sm, box.height / 2)) };
  };

  it('sets every value of a row of six on one line, whole or abbreviated', () => {
    const { values, width, fitted } = row(realStoryboard());
    expect(values).toHaveLength(5);
    fitted.forEach((value, i) => {
      expect(value.lines, values[i]).toHaveLength(1);
      expect([values[i], abbreviate(values[i]!)], values[i]).toContain(value.lines[0]);
      expect(widthOf(value, value.role.face), values[i]).toBeLessThanOrEqual(width);
    });
  });
  it('sets the figures of a row at one size, at or above the display floor', () => {
    const { fitted } = row(realStoryboard());
    expect(fitted.every((value) => value.role === ROLES.value[0])).toBe(true);
    expect(new Set(fitted.map((value) => value.size)).size).toBe(1);
    expect(fitted[0]!.size).toBeGreaterThanOrEqual(floor.display);
  });
  it('keeps a value at the schema limit on one line too', () => {
    const { fitted, width } = row(stressStoryboard());
    for (const value of fitted) {
      expect(value.lines).toHaveLength(1);
      expect(widthOf(value, value.role.face)).toBeLessThanOrEqual(width);
    }
  });
});

describe('the prompt under the glass', () => {
  const cuts = [['captions', true], ['voiced', false]] as const;
  const laidOut = (sb: Storyboard, captions: boolean) => {
    const scene = sceneOf(sb, 'prompt');
    const lens = shotOf(scene, captions).lens;
    return { lens, ...layoutPrompt(scene, lens, captions ? HEIGHT - layout.captionInset : HEIGHT) };
  };

  it.each(cuts)('shows at most 190 characters of a long request, cut at a word (%s cut)', (_, captions) => {
    for (const sb of [realStoryboard(), stressStoryboard()]) {
      const { fitted } = laidOut(sb, captions);
      const shown = fitted.lines.join(' ');
      expect(Array.from(shown).length).toBeLessThanOrEqual(PROMPT_SHOWN);
      expect(shown.endsWith('…')).toBe(true);
      // The 190 characters fit: the fitting takes nothing more away, and sets nothing below the floor.
      expect(fitted.cut).toBe(false);
      expect(fitted.size).toBeGreaterThanOrEqual(floor.text);
    }
  });

  it.each(cuts)('keeps every line a clear margin inside the rim (%s cut)', (_, captions) => {
    expect(shot.prompt.rim).toBeGreaterThanOrEqual(layout.margin);
    for (const sb of [realStoryboard(), stressStoryboard()]) {
      const { lens, room, fitted, above, below } = laidOut(sb, captions);
      const clear = loupe.glass * lens.scale - shot.prompt.rim;
      const lineHeight = fitted.size * fitted.role.type.leading;
      const top = -(above + fitted.lines.length * lineHeight + below) / 2 + above;
      expect(fitted.lines.length).toBeGreaterThan(1);
      fitted.lines.forEach((line, i) => {
        const half = widthOf({ ...fitted, lines: [line] }, fitted.role.face) / 2;
        // Both ends of the line, at its top and at its bottom, lie inside the glass less the margin.
        for (const y of [top + i * lineHeight, top + (i + 1) * lineHeight]) {
          expect(Math.hypot(Math.abs(room.cx) + half, room.cy + y), line).toBeLessThanOrEqual(clear);
        }
      });
    }
  });
});
