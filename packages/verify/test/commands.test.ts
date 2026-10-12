import { describe, expect, it } from 'vitest';
import { classifyCommand } from '../src/index';

describe('classifyCommand', () => {
  it('classifies commands', () => {
    expect(classifyCommand('cd app && pnpm test -- --run')).toBe('test');
    expect(classifyCommand('npx tsc --noEmit')).toBe('typecheck');
    expect(classifyCommand('git status')).toBe('other');
  });

  it('classifies lint and build commands', () => {
    expect(classifyCommand('pnpm run lint')).toBe('lint');
    expect(classifyCommand('next build')).toBe('build');
    expect(classifyCommand('make')).toBe('build');
  });

  it('treats "make test" as test, not build', () => {
    expect(classifyCommand('make test')).toBe('test');
  });

  it('prefers test over build when a command chain has both', () => {
    expect(classifyCommand('next build && pnpm test')).toBe('test');
  });

  it('classifies pm typecheck scripts as typecheck', () => {
    expect(classifyCommand('pnpm typecheck')).toBe('typecheck');
    expect(classifyCommand('pnpm run type-check')).toBe('typecheck');
    expect(classifyCommand('yarn check-types')).toBe('typecheck');
  });
});
