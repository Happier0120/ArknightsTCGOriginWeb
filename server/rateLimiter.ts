export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface FixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export class FixedWindowRateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor({ limit, windowMs, now = Date.now }: FixedWindowRateLimiterOptions) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("限流次数必须是正整数");
    }
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error("限流窗口必须大于0");
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  consume(key: string): RateLimitResult {
    const currentTime = this.now();
    const existing = this.buckets.get(key);
    const bucket = !existing || currentTime >= existing.resetAt
      ? { count: 0, resetAt: currentTime + this.windowMs }
      : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return {
      allowed: bucket.count <= this.limit,
      retryAfterMs: bucket.count <= this.limit
        ? 0
        : Math.max(1, bucket.resetAt - currentTime),
    };
  }

  delete(key: string) {
    this.buckets.delete(key);
  }

  pruneExpired() {
    const currentTime = this.now();
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (currentTime >= bucket.resetAt) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
