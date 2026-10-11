const WINDOW_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A sliding-window token bucket: at most `maxPerWindow` acquisitions in any trailing 60s window. */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private readonly maxPerWindow: number) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < WINDOW_MS);
      if (this.timestamps.length < this.maxPerWindow) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0]!;
      await sleep(WINDOW_MS - (now - oldest));
    }
  }
}

/** Shared across every ModelClient created by createRouter — the gateway limit is per process, not per client. */
export const sharedLimiter = new RateLimiter(50);
