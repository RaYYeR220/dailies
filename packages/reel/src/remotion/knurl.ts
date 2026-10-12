// The knurling of the loupe's barrel: pure, so it runs under vitest.

const n3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The ticks a dashed circle is made of, as one path to be filled: a circle of `radius` about the origin, stroked
 * `width` wide, `dash` on and `gap` off, starting `offset` into that pattern. It follows a dashed stroke exactly:
 * from three o'clock, clockwise on a screen, and the last tick is cut off at the seam.
 *
 * A dashed stroke looks the same and costs far more. Without a graphics card the browser cuts the circle into its
 * several hundred dashes and outlines each of them again for every tile of the frame the ring touches; a filled
 * path is cut once, here.
 */
export function ticks(radius: number, width: number, dash: number, gap: number, offset = 0): string {
  const round = 2 * Math.PI * radius;
  const period = dash + gap;
  const [outer, inner] = [radius + width / 2, radius - width / 2];
  const corner = (r: number, along: number) => `${n3(r * Math.cos(along / radius))},${n3(r * Math.sin(along / radius))}`;
  let d = '';
  for (let k = Math.floor(offset / period); k * period - offset < round; k++) {
    const from = Math.max(0, k * period - offset);
    const to = Math.min(round, k * period - offset + dash);
    // A tick is so short that its two arcs are straight to a thousandth of a pixel.
    if (to > from) d += `M${corner(outer, from)}L${corner(outer, to)}L${corner(inner, to)}L${corner(inner, from)}Z`;
  }
  return d;
}
