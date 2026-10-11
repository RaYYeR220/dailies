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

describe('theme', () => {
  it('keeps the backdrop above the blackdetect pixel threshold, so the review stage never reads a dark frame as black', () => {
    // blackdetect counts a pixel as black at luma <= 0.10; 0.12 leaves room for encoder noise.
    expect(luma(theme.color.bg)).toBeGreaterThanOrEqual(0.12);
    expect(luma(theme.color.bgGlow)).toBeGreaterThanOrEqual(0.12);
    expect(theme.backdrop).toContain(theme.color.bg);
  });

  it('keeps every type size readable at 1080p', () => {
    const sizes = Object.values(theme.size).flatMap((s) => (typeof s === 'number' ? [s] : [s.min, s.max]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(22);
  });

  it('names a family for display, text and code', () => {
    for (const family of [theme.font.display, theme.font.text, theme.font.mono]) expect(family).toMatch(/\S/);
    expect(new Set([theme.font.display, theme.font.text, theme.font.mono]).size).toBe(3);
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
    expect(files.length).toBeGreaterThanOrEqual(9);   // seven scenes, Reel, Root
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
