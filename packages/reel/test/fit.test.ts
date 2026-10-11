import { describe, it, expect } from 'vitest';
import { FACE, emOf } from '../src/remotion/measure';
import { boxRoom } from '../src/remotion/text';
import { ROLES, fitRef, fitRepo, fitRoles, heightOf, widthOf } from '../src/remotion/ui';
import { theme } from '../src/theme';

// Outside a browser a face is measured by estimate, which is enough to pin the rules of fitting.
const { floor, size } = theme;

describe('fitRoles', () => {
  it('sets a short quote in display, at or above the display floor', () => {
    const fitted = fitRoles('All tests pass.', ROLES.claim, boxRoom(700, 360));
    expect(fitted.role).toBe(ROLES.claim[0]);
    expect(fitted.size).toBeGreaterThanOrEqual(floor.display);
    expect(fitted.cut).toBe(false);
  });
  it('moves a quote too long for display to the text face instead of cutting it', () => {
    const quote = 'Everything is implemented, all of the tests pass and the build is green, so this is ready to merge.';
    const fitted = fitRoles(quote, ROLES.claim, boxRoom(700, 360));
    expect(fitted.role).toBe(ROLES.claim[1]);
    expect(fitted.cut).toBe(false);
    expect(fitted.size).toBeGreaterThanOrEqual(floor.text);
    expect(fitted.lines.join(' ')).toBe(quote);
  });
  it('cuts with an ellipsis only when the text face at its floor cannot hold the text either', () => {
    const fitted = fitRoles('word '.repeat(200).trim(), ROLES.claim, boxRoom(700, 360));
    expect(fitted).toMatchObject({ role: ROLES.claim[1], size: floor.text, cut: true });
    expect(fitted.lines.at(-1)!.endsWith('…')).toBe(true);
    expect(heightOf(fitted)).toBeLessThanOrEqual(360);
  });
  it('never sets any role below its floor', () => {
    for (const roles of Object.values(ROLES)) {
      for (const role of roles) {
        const family: string = role.face.family;
        const min = family === theme.font.code ? floor.code : family === theme.font.display ? floor.display : floor.text;
        expect(role.type.min).toBeGreaterThanOrEqual(min);
      }
    }
  });
});

describe('fitRepo', () => {
  const room = (width: number, height: number) => (above: number, below: number) => boxRoom(width, height - above - below);

  it('keeps a short name on one line of display, owner and all', () => {
    const fit = fitRepo('acme/api', size.display.repo, room(700, 400));
    expect(fit.owner).toBeNull();
    expect(fit.name.lines).toEqual(['acme/api']);
    expect(fit.name.size).toBeGreaterThan(size.display.repo.min);
  });
  it('puts the owner on a line of its own, in the text face, when the whole name would come out small', () => {
    const fit = fitRepo('acme/retry-queue', size.display.repo, room(620, 400));
    expect(fit.owner?.lines).toEqual(['acme/']);
    expect(fit.name.lines).toEqual(['retry-queue']);
    expect(fit.height).toBeGreaterThan(fit.name.size);
  });
  it('breaks a long name where a name may break, and never below the display floor', () => {
    const fit = fitRepo('a-rather-long-organisation-name/monorepo-with-a-very-descriptive-name', size.display.repo, room(620, 500), 4);
    expect(fit.name.size).toBeGreaterThanOrEqual(floor.display);
    expect(fit.name.lines.length).toBeGreaterThan(1);
    for (const line of fit.name.lines.slice(0, -1)) expect(line).toMatch(/[-_.]$/);
    expect(fit.name.lines.join('')).toBe('monorepo-with-a-very-descriptive-name');
    expect(widthOf(fit.name, FACE.heavy)).toBeLessThanOrEqual(620);
  });
  it('shortens an owner that is wider than its line', () => {
    const fit = fitRepo('a-rather-long-organisation-name/monorepo', size.display.repo, room(300, 400));
    expect(fit.owner?.cut).toBe(true);
    expect(emOf(FACE.body)(fit.owner!.lines[0]!) * fit.owner!.size).toBeLessThanOrEqual(300);
  });
  it('fits a name with no owner on its own', () => {
    expect(fitRepo('dailies', size.display.repo, room(700, 400))).toMatchObject({ owner: null, name: { lines: ['dailies'] } });
  });
});

describe('fitRef', () => {
  const px = (text: string) => emOf(FACE.code)(text) * size.code.ref;

  it('names the session where there is room, and leaves the word out where there is not', () => {
    expect(fitRef('s2:31', 2000)).toBe('session s2 · entry 31');
    expect(fitRef('s2:31', px('session s2 · entry 31') - 1)).toBe('s2 · entry 31');
  });
  it('cuts the reference when even the short form is too wide', () => {
    const ref = fitRef('s2:31', px('s2 · entry 31') - 1);
    expect(ref.endsWith('…')).toBe(true);
    expect(px(ref)).toBeLessThanOrEqual(px('s2 · entry 31'));
  });
});
