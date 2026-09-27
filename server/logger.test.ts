import { describe, expect, it } from "vitest";
import { StructuredLogger } from "./logger";

describe("结构化服务日志", () => {
  it("输出可检索的 JSON 事件", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      now: () => Date.UTC(2026, 8, 27, 8, 0, 0),
      write: (line) => lines.push(line),
    });
    logger.info("server_listening", { port: 4174, rooms: 2 });

    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-09-27T08:00:00.000Z",
      level: "info",
      event: "server_listening",
      port: 4174,
      rooms: 2,
    });
  });

  it("递归遮蔽令牌、随机种子和完整对局状态", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ write: (line) => lines.push(line) });
    logger.error("persistence_failed", {
      sessionToken: "must-not-leak",
      nested: { seed: "secret-seed", gameState: { turn: 2 } },
      error: new Error("磁盘不可写"),
    });

    const parsed = JSON.parse(lines[0]);
    expect(parsed.sessionToken).toBe("[REDACTED]");
    expect(parsed.nested).toEqual({
      seed: "[REDACTED]",
      gameState: "[REDACTED]",
    });
    expect(parsed.error).toEqual({ name: "Error", message: "磁盘不可写" });
    expect(lines[0]).not.toContain("must-not-leak");
    expect(lines[0]).not.toContain("secret-seed");
  });
});
