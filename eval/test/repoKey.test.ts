import { describe, expect, it } from 'vitest';
import { repoKey } from '../src/index';

describe('repoKey', () => {
  it('is stable and 8 hex characters', () => {
    const url = 'https://github.com/entireio/cli';
    const a = repoKey(url);
    const b = repoKey(url);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).toHaveLength(8);
    expect(repoKey('https://github.com/acme/widgets')).not.toBe(a);
  });
});
