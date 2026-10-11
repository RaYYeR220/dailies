import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../src/limiter';

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the limiter delays the 51st request inside one minute', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(50);
    for (let i = 0; i < 50; i++) await limiter.acquire();

    let resolved = false;
    limiter.acquire().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBe(true);
  });

  it('does not delay the first 50 requests inside one minute', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(50);
    const startedAt = Date.now();
    for (let i = 0; i < 50; i++) await limiter.acquire();
    expect(Date.now()).toBe(startedAt);
  });
});
