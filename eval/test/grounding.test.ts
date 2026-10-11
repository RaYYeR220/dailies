import { describe, expect, it } from 'vitest';
import { runGroundingBenchmark } from '../src/grounding';

describe('runGroundingBenchmark', () => {
  it('rejects 20 of 20 fabricated lines and accepts 20 of 20 genuine ones', () => {
    const result = runGroundingBenchmark();
    expect(result).toEqual({ fabricated: 20, rejected: 20, genuine: 20, accepted: 20 });
  });
});
