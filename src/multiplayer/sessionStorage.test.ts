// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRoomSession,
  loadRoomSession,
  ROOM_SESSION_KEY,
  saveRoomSession,
} from "./sessionStorage";

beforeEach(() => window.sessionStorage.clear());

describe("联网房间会话存储", () => {
  it("保存并读取当前标签页的房间身份", () => {
    const session = {
      playerId: "player-identity",
      sessionToken: "secret-token",
      roomCode: "ATCG73",
    };
    saveRoomSession(window.sessionStorage, session);
    expect(loadRoomSession(window.sessionStorage)).toEqual(session);
  });

  it("清除损坏或主动离开的会话", () => {
    window.sessionStorage.setItem(ROOM_SESSION_KEY, "not-json");
    expect(loadRoomSession(window.sessionStorage)).toBeNull();
    expect(window.sessionStorage.getItem(ROOM_SESSION_KEY)).toBeNull();

    saveRoomSession(window.sessionStorage, {
      playerId: "player-identity",
      sessionToken: "secret-token",
      roomCode: "ATCG73",
    });
    clearRoomSession(window.sessionStorage);
    expect(loadRoomSession(window.sessionStorage)).toBeNull();
  });
});
