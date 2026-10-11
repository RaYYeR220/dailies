import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { theme } from '../src/theme';

const REMOTION_DIR = fileURLToPath(new URL('../src/remotion', import.meta.url));
const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : []));

/** Gamma-encoded luma, 0..1: the quantity ffmpeg's blackdetect compares with its pixel threshold. */
function luma(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((c) => parseInt(c, 16) / 255) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Largest difference between two channels, 0..255: how far a colour is from a grey. */
function chroma(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const rgb = [m[1]!, m[2]!, m[3]!].map((c) => parseInt(c, 16));
  return Math.max(...rgb) - Math.min(...rgb);
}

const leaves = (node: unknown): unknown[] => (node !== null && typeof node === 'object' ? Object.values(node).flatMap(leaves) : [node]);

describe('theme', () => {
  it('carries the Loupe surface, the cool white and the grease pencil', () => {
    expect(theme.color.lightbox.far).toBe('#0d1211');
    expect(theme.color.lightbox.near).toBe('#1a2421');
    expect(theme.color.white).toBe('#eef3f1');
    expect(theme.color.pencil).toBe('#ffd60a');
    expect(theme.backdrop({ x: 960, y: 540, scale: 1 })).toContain(theme.color.lightbox.far);
  });

  it('has no accent colour other than the pencil', () => {
    const colours = leaves(theme.color) as string[];
    expect(colours.length).toBeGreaterThan(8);
    for (const c of colours) expect(c, 'every colour is a plain #rrggbb').toMatch(/^#[0-9a-f]{6}$/);
    expect(colours.filter((c) => chroma(c) > 40)).toEqual([theme.color.pencil]);
  });

  it('sets display in Unbounded, text in Figtree and code in Martian Mono', () => {
    expect(theme.font.display).toMatch(/^"Unbounded"/);
    expect(theme.font.text).toMatch(/^"Figtree"/);
    expect(theme.font.code).toMatch(/^"Martian Mono"/);
  });

  it('keeps every type size at or above the legibility floor of its role', () => {
    expect(theme.floor).toEqual({ display: 72, text: 40, code: 30 });
    for (const role of ['display', 'text', 'code'] as const) {
      const sizes = leaves(theme.size[role]) as number[];
      expect(sizes.length, role).toBeGreaterThan(0);
      expect(Math.min(...sizes), role).toBeGreaterThanOrEqual(theme.floor[role]);
    }
  });

  it('keeps the lit glass above the blackdetect pixel threshold, so the review stage never reads a frame as black', () => {
    // blackdetect counts a pixel as black at luma <= 0.10 and a frame as black when 98% of its pixels are.
    // The room is darker than that on purpose; the glass is in every frame and is not. lens.test.ts pins its share.
    expect(luma(theme.color.film.lit)).toBeGreaterThanOrEqual(0.12);
    expect(luma(theme.color.lightbox.far)).toBeLessThan(0.1);
  });

  it('lands every entrance before the middle of a scene, where the review still is taken', () => {
    expect(theme.motion.settleBy).toBeGreaterThan(0);
    expect(theme.motion.settleBy).toBeLessThan(0.5);
  });

  it('draws the loupe from the inside out: glass, barrel, skirt', () => {
    const { glass, barrel, skirt } = theme.loupe;
    expect(glass).toBeLessThan(barrel.radius - barrel.width / 2 + 1);
    expect(barrel.radius + barrel.width / 2).toBeLessThanOrEqual(skirt.inner + 1);
    expect(skirt.inner).toBeLessThan(skirt.outer);
  });
});

describe('scenes', () => {
  it('has one component per scene type', () => {
    expect(readdirSync(join(REMOTION_DIR, 'scenes')).sort()).toEqual(['Diff.tsx', 'End.tsx', 'Flag.tsx', 'Prompt.tsx', 'Stats.tsx', 'Terminal.tsx', 'Title.tsx']);
  });

  // The art direction is replaced through theme.ts alone, so nothing under src/remotion may carry a visual value of its own.
  const FORBIDDEN: [string, RegExp][] = [
    ['hex colour', /#[0-9a-fA-F]{3,8}\b/],
    ['colour function', /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(/],
    ['literal colour', /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*[:=]\s*\{?\s*['"`](?!none['"`]|transparent['"`]|currentColor['"`])/],
    ['font name', /\bfontFamily\s*[:=]\s*\{?\s*['"`]/],
    ['type size', /\bfontSize\s*[:=]\s*\{?\s*['"`\d]/],
    ['radius', /\b(?:borderRadius|rx|ry)\s*[:=]\s*\{?\s*['"`\d]/],
    ['weight, leading or tracking', /\b(?:fontWeight|lineHeight|letterSpacing)\s*[:=]\s*\{?\s*['"`\d]/],
    ['length with a unit', /\d(?:px|rem|em|pt|vh|vw)\b/],
  ];

  it('takes every colour, font, size and radius from the theme', () => {
    const files = tsxFiles(REMOTION_DIR);
    expect(files.length).toBeGreaterThanOrEqual(9);   // seven scenes, Reel, Root, and the shared pieces
    const hits = files.flatMap((file) =>
      readFileSync(file, 'utf8').split('\n').flatMap((line, i) =>
        FORBIDDEN.filter(([, re]) => re.test(line)).map(([what]) => `${file.slice(REMOTION_DIR.length + 1)}:${i + 1} ${what}: ${line.trim()}`)));
    expect(hits).toEqual([]);
  });

  it('catches the values it is meant to catch', () => {
    const bad = ["color: '#fff'", 'background: "rgb(0 0 0)"', "color: 'white'", "fontFamily: 'Inter'", 'fontSize: 48', 'fontSize={48}', 'borderRadius: 12', "padding: '12px 16px'", 'fontWeight: 600', 'lineHeight: 1.2'];
    for (const line of bad) expect(FORBIDDEN.some(([, re]) => re.test(line)), line).toBe(true);
    const fine = ['color: theme.color.text', 'fontSize: size.label', 'fill="none"', 'border: `${stroke.hair}px solid ${color.edge}`', "width: '100%'", 'borderRadius: radius.md', 'opacity: 0.5'];
    for (const line of fine) expect(FORBIDDEN.some(([, re]) => re.test(line)), line).toBe(false);
  });
});
