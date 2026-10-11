import { describe, it, expect } from 'vitest';
import { traced, guard } from '../src/trace';

describe('traced', () => {
  it('wraps a function and returns its result unchanged', async () => {
    const wrapped = traced('TOOL', 'my-tool', async (x: number) => x * 2);
    await expect(wrapped(21)).resolves.toBe(42);
  });

  it('propagates a thrown error from the wrapped function', async () => {
    const wrapped = traced('AGENT', 'my-agent', async () => {
      throw new Error('boom');
    });
    await expect(wrapped()).rejects.toThrow('boom');
  });
});

describe('guard', () => {
  it('returns the check result unchanged', async () => {
    const result = await guard('no-secrets', async () => ({ pass: true, reasons: [] }));
    expect(result).toEqual({ pass: true, reasons: [] });
  });

  it('returns a failing check result unchanged', async () => {
    const result = await guard('no-secrets', async () => ({ pass: false, reasons: ['found a key'] }));
    expect(result).toEqual({ pass: false, reasons: ['found a key'] });
  });
});
