import React, { useContext, useLayoutEffect, useMemo, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Img, continueRender, delayRender } from 'remotion';
import { theme } from '../theme';
import { PENCIL_REGION, dashesDrawn, markExtent, markPaths, markShown, type MarkKind } from './pencil';
import { SceneContext } from './ui';

const { color, pencil } = theme;

type Hand = 'large' | 'medium' | 'small';
const HANDS: Hand[] = ['large', 'medium', 'small'];
const filterId = (hand: Hand) => `pencil-${hand}`;
const percent = (share: number) => `${share * 100}%`;

/** The grease-pencil filter of one hand: the stroke is made to wobble, then waxy holes are knocked in it. */
const Wax: React.FC<{ hand: Hand }> = ({ hand }) => {
  const { wobble, wax } = pencil[hand];
  return (
    <filter id={filterId(hand)} x={percent(-PENCIL_REGION.x)} y={percent(-PENCIL_REGION.y)} width={percent(1 + 2 * PENCIL_REGION.x)} height={percent(1 + 2 * PENCIL_REGION.y)}>
      <feTurbulence type="fractalNoise" baseFrequency={wobble.frequency} numOctaves={wobble.octaves} seed={wobble.seed} result="wobble" />
      <feDisplacementMap in="SourceGraphic" in2="wobble" scale={wobble.scale} xChannelSelector="R" yChannelSelector="G" result="stroke" />
      {wax ? (
        <>
          <feTurbulence type="fractalNoise" baseFrequency={wax.frequency} numOctaves={2} seed={wax.seed} result="grain" />
          <feColorMatrix in="grain" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 ${wax.cut}`} result="holes" />
          <feComposite in="stroke" in2="holes" operator="in" />
        </>
      ) : null}
    </filter>
  );
};

/** The grease-pencil filters, once per document. */
export const PencilDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: 'absolute' }}>
    <defs>
      {HANDS.map((hand) => (
        <Wax key={hand} hand={hand} />
      ))}
    </defs>
  </svg>
);

// How the time of a mark is shared between its strokes: a cross is two equal strokes, a question mark a hook and a dot.
const SHARES: Record<MarkKind, number[]> = { ring: [1], dashed: [1], cross: [0.5, 0.5], question: [0.82, 0.18] };

/** All that decides what a mark looks like once it is drawn. */
interface Recipe { kind: MarkKind; width: number; height: number; seed: number; stroke: number; hand: Hand }

/** The strokes of a mark about its own centre, through the filter of its hand. `progress` 0..1 draws them on, stroke by stroke, the way the hand would. */
const Strokes: React.FC<{ recipe: Recipe; progress: number }> = ({ recipe, progress }) => {
  const { kind, width, height, seed, stroke, hand } = recipe;
  const shares = SHARES[kind];
  let before = 0;
  return (
    <g fill="none" stroke={color.pencil} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${filterId(hand)})`}>
      {/* An unstroked box the size of the mark: it keeps the filter region still while the strokes grow. */}
      <rect x={-width / 2} y={-height / 2} width={width} height={height} stroke="none" />
      {markPaths(kind, width, height, seed).map((d, i) => {
        const share = shares[i] ?? 1;
        const drawn = Math.max(0, Math.min(1, (progress - before) / share));
        before += share;
        const dashes = kind === 'dashed' ? dashesDrawn(drawn, pencil.dash.count, pencil.dash.fill) : [drawn, 2];
        return <path key={i} d={d} pathLength={1} strokeDasharray={dashes.join(' ')} strokeOpacity={drawn > 0 ? 1 : 0} />;
      })}
    </g>
  );
};

/** All the pencil filter works on, as a box about the centre of the mark, a whole number of px each way. */
interface Extent { x: number; y: number }
const boxOf = ({ x, y }: Extent) => ({ width: 2 * x, height: 2 * y, viewBox: `${-x} ${-y} ${2 * x} ${2 * y}` });

// One picture per recipe, for the life of the page: a PNG of the finished mark. A recipe that could not be drawn
// is remembered too, as null, and goes through the filter on every frame as before.
const pictures = new Map<string, string | null>();
const developing = new Map<string, Promise<void>>();

/**
 * Draws a finished mark once, through the very filter that draws it live: the same strokes and the same filter in
 * the same box, as an image of their own, rasterised onto a canvas. The turbulence the filter is made of is the
 * most expensive thing in a frame when there is no graphics card, and a finished mark never changes.
 *
 * The browser works the filter out square to the mark and then lays the result on the tilted film, which is
 * just what showing the picture in the mark's place does: the two come out alike to within a rounding.
 */
function develop(recipe: Recipe, extent: Extent, key: string): Promise<void> {
  const known = developing.get(key);
  if (known) return known;
  const job = (async () => {
    const markup = renderToStaticMarkup(
      <svg xmlns="http://www.w3.org/2000/svg" {...boxOf(extent)}>
        <defs>
          <Wax hand={recipe.hand} />
        </defs>
        <Strokes recipe={recipe} progress={1} />
      </svg>,
    );
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const density = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(2 * extent.x * density);
    canvas.height = Math.round(2 * extent.y * density);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no canvas to draw a pencil mark on');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    pictures.set(key, canvas.toDataURL('image/png'));
  })().catch(() => { pictures.set(key, null); });
  developing.set(key, job);
  return job;
}

/** The picture of a finished mark, or null while there is none; the frame waits until it has been drawn. */
function usePicture(recipe: Recipe, extent: Extent, wanted: boolean): string | null {
  const key = wanted ? JSON.stringify([recipe.kind, recipe.width, recipe.height, recipe.seed, recipe.stroke, recipe.hand]) : null;
  const [, developed] = useState(0);
  useLayoutEffect(() => {
    if (key === null || pictures.has(key)) return;
    const handle = delayRender('Drawing a pencil mark');
    let live = true;
    void develop(recipe, extent, key).then(() => { if (live) developed((n) => n + 1); continueRender(handle); });
    return () => { live = false; };
    // The key says all there is to say about the recipe, and the extent follows from it.
  }, [key]);
  return key === null ? null : pictures.get(key) ?? null;
}

/**
 * One pencil mark in a `width` by `height` box centred on (`x`, `y`) of its positioned parent.
 * `progress` 0..1 draws it on, stroke by stroke, the way the hand would.
 */
export const Mark: React.FC<{ kind: MarkKind; x: number; y: number; width: number; height: number; seed: number; progress?: number; weight?: number; opacity?: number }> = ({
  kind, x, y, width, height, seed, progress = 1, weight, opacity = 1,
}) => {
  const scene = useContext(SceneContext);
  const reach = Math.max(width, height);
  const hand: Hand = reach >= pencil.large.above ? 'large' : reach >= pencil.medium.above ? 'medium' : 'small';
  const stroke = weight ?? Math.max(pencil.weight.min, Math.min(pencil.weight.max, reach * pencil.weight.share));
  const recipe: Recipe = { kind, width, height, seed, stroke, hand };
  const extent = useMemo(() => markExtent(kind, width, height, seed), [kind, width, height, seed]);
  const shown = markShown(progress, scene?.resting ?? false);
  const picture = usePicture(recipe, extent, shown === 'kept');
  if (shown === 'nothing') return null;
  // The live mark and its picture take the same box: a whole number of px about the centre, so neither is scaled
  // to fit a pixel grid and the one can stand in for the other.
  const box = boxOf(extent);
  const place = { position: 'absolute', left: x - extent.x, top: y - extent.y, width: box.width, height: box.height, opacity } as const;
  if (picture) return <Img src={picture} decoding="sync" style={place} />;
  return (
    <svg {...box} style={place}>
      <Strokes recipe={recipe} progress={progress} />
    </svg>
  );
};
