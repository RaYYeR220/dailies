import { describe, it, expect } from 'vitest';
import { Claim, Scene, entryId } from '../src/index';

describe('schema', () => {
  it('rejects a claim without a quote', () => {
    expect(Claim.safeParse({ id: 'c1', sessionId: 's', entryId: 's:1', kind: 'tests_pass' }).success).toBe(false);
  });
  it('requires evidence on every narration line', () => {
    const scene = { id: 'sc1', type: 'prompt', quote: 'q', sessionId: 's', entryId: 's:0',
      lines: [{ id: 'l1', text: 'The prompt asked for a retry.', evidence: [] }] };
    expect(Scene.safeParse(scene).success).toBe(false);
  });
  it('builds stable entry ids', () => { expect(entryId('abc', 7)).toBe('abc:7'); });
});
