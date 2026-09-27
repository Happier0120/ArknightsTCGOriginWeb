import { describe, expect, it } from "vitest";
import type { OnlineGameSnapshot } from "./protocol";
import { chooseLatestGameSnapshot } from "./protocol";

function snapshot(revision: number) {
  return { revision, state: { revision } } as unknown as OnlineGameSnapshot;
}

describe("联网对局快照版本", () => {
  it("接收更新版本与同版本确认响应", () => {
    expect(chooseLatestGameSnapshot(snapshot(2), snapshot(3)).revision).toBe(3);
    expect(chooseLatestGameSnapshot(snapshot(3), snapshot(3)).revision).toBe(3);
  });

  it("忽略迟到的旧状态包", () => {
    const current = snapshot(4);
    expect(chooseLatestGameSnapshot(current, snapshot(3))).toBe(current);
  });
});
