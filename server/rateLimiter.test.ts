import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rateLimiter";

describe("Socket 固定窗口限流", () => {
  it("在窗口内超过配额后拒绝，并给出剩余等待时间", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 2,
      windowMs: 5_000,
      now: () => now,
    });

    expect(limiter.consume("player-a")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.consume("player-a")).toEqual({ allowed: true, retryAfterMs: 0 });
    now = 2_000;
    expect(limiter.consume("player-a")).toEqual({
      allowed: false,
      retryAfterMs: 4_000,
    });
    expect(limiter.consume("player-b").allowed).toBe(true);
  });

  it("窗口结束后恢复配额，并能清理离线或过期键", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      limit: 1,
      windowMs: 1_000,
      now: () => now,
    });
    limiter.consume("socket-a");
    limiter.consume("socket-b");
    limiter.delete("socket-a");
    expect(limiter.consume("socket-a").allowed).toBe(true);

    now = 2_001;
    expect(limiter.pruneExpired()).toBe(2);
    expect(limiter.consume("socket-b").allowed).toBe(true);
  });
});
