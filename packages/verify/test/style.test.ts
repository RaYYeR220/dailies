import { describe, expect, it } from 'vitest';
import { lintStyle } from '../src/index';

describe('lintStyle', () => {
  it('accepts a clean short line', () => {
    expect(lintStyle('The fix closed the null check gap.')).toEqual([]);
  });

  it('flags more than one sentence', () => {
    expect(lintStyle('Tests passed. Build succeeded.').length).toBeGreaterThan(0);
  });

  it('flags more than 26 words', () => {
    const text = `${Array.from({ length: 27 }, () => 'word').join(' ')}.`;
    expect(lintStyle(text).length).toBeGreaterThan(0);
  });

  it('flags an em dash and an exclamation mark', () => {
    expect(lintStyle('Great work, truly excellent!').length).toBeGreaterThan(0);
    expect(lintStyle('Great work — a clean fix').length).toBeGreaterThan(0);
  });

  it('flags a spelled-out number from one to twenty', () => {
    expect(lintStyle('It took seven attempts to fix.').length).toBeGreaterThan(0);
  });

  it('flags a banned phrase', () => {
    expect(lintStyle('This is a seamless, robust solution.').length).toBeGreaterThan(0);
  });
});
