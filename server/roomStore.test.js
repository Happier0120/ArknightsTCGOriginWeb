import { describe, expect, it } from "vitest";
import { RoomStore } from "./roomStore.mjs";

function createStore() {
  const ids = ["player-1", "token-1", "player-2", "token-2", "player-3", "token-3"];
  return new RoomStore({
    createCode: () => "ATCG71",
    createId: () => ids.shift(),
  });
}

function createTwoPlayerRoom(store) {
  const host = store.createRoom({
    playerName: "博士A",
    deckId: "rhodes-island-starter",
    socketId: "socket-1",
  });
  const guest = store.joinRoom({
    roomCode: host.room.code,
    playerName: "博士B",
    deckId: "reunion-starter",
    socketId: "socket-2",
  });
  return { host, guest };
}

describe("RoomStore", () => {
  it("创建房间并把第二名玩家放入玩家2席位", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);

    expect(host.room.code).toBe("ATCG71");
    expect(guest.room.players).toMatchObject([
      { id: "player-1", seat: "player1", isHost: true },
      { id: "player-2", seat: "player2", isHost: false },
    ]);
    expect(guest.room.status).toBe("waiting");
  });

  it("仅允许双方在线准备后由房主开始", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);

    store.updateRoom({ sessionToken: host.sessionToken, ready: true });
    const readyRoom = store.updateRoom({
      sessionToken: guest.sessionToken,
      ready: true,
    });
    expect(readyRoom.status).toBe("ready");
    expect(() => store.startRoom(guest.sessionToken)).toThrow("只有房主");
    expect(store.startRoom(host.sessionToken).status).toBe("started");
  });

  it("拒绝第三名玩家加入", () => {
    const store = createStore();
    const { host } = createTwoPlayerRoom(store);

    expect(() => store.joinRoom({
      roomCode: host.room.code,
      playerName: "博士C",
      deckId: "rhodes-island-starter",
      socketId: "socket-3",
    })).toThrow("房间已满");
  });

  it("掉线后撤销房间就绪状态", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);
    store.updateRoom({ sessionToken: host.sessionToken, ready: true });
    store.updateRoom({ sessionToken: guest.sessionToken, ready: true });

    const [room] = store.disconnectSocket("socket-2");
    expect(room.status).toBe("waiting");
    expect(room.players[1]).toMatchObject({ connected: false, ready: true });
    expect(() => store.startRoom(host.sessionToken)).toThrow("双方在线并准备");

    const resumed = store.resumeRoom({
      sessionToken: guest.sessionToken,
      socketId: "socket-2-new",
    });
    expect(resumed.status).toBe("ready");
    expect(resumed.players[1].connected).toBe(true);
    expect(() =>
      store.requireSocketMembership(guest.sessionToken, "socket-2"),
    ).toThrow("当前连接已被新的会话替代");
    expect(store.requireSocketMembership(
      guest.sessionToken,
      "socket-2-new",
    ).player.id).toBe(guest.playerId);
  });

  it("房主离开时转移房主并取消剩余玩家的准备", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);
    store.updateRoom({ sessionToken: guest.sessionToken, ready: true });

    const room = store.leaveRoom(host.sessionToken);
    expect(room?.players).toEqual([
      expect.objectContaining({
        id: guest.playerId,
        seat: "player1",
        isHost: true,
        ready: false,
      }),
    ]);
    expect(store.leaveRoom(guest.sessionToken)).toBeNull();
  });

  it("对局开始后离开会保留席位并标记断线", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);
    store.updateRoom({ sessionToken: host.sessionToken, ready: true });
    store.updateRoom({ sessionToken: guest.sessionToken, ready: true });
    store.startRoom(host.sessionToken);

    const room = store.leaveRoom(guest.sessionToken);
    expect(room?.players).toHaveLength(2);
    expect(room?.players[1]).toMatchObject({
      id: guest.playerId,
      connected: false,
    });
  });

  it("只接受匹配当前版本的对局更新并在成功后递增版本", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);
    store.updateRoom({ sessionToken: host.sessionToken, ready: true });
    store.updateRoom({ sessionToken: guest.sessionToken, ready: true });
    store.startRoom(host.sessionToken);
    store.setGame(host.room.code, { marker: "initial" });

    expect(store.getGameMembership(host.sessionToken).gameRevision).toBe(0);
    expect(store.updateGame(
      host.room.code,
      { marker: "accepted" },
      0,
    )).toMatchObject({ gameRevision: 1 });
    expect(() => store.updateGame(
      host.room.code,
      { marker: "duplicate" },
      0,
    )).toThrow("对局状态已更新");
    expect(store.getGameMembership(host.sessionToken)).toMatchObject({
      gameRevision: 1,
      gameState: { marker: "accepted" },
    });
  });

  it("结束房间保留双方结算席位并在双方离开后关闭", () => {
    const store = createStore();
    const { host, guest } = createTwoPlayerRoom(store);
    store.updateRoom({ sessionToken: host.sessionToken, ready: true });
    store.updateRoom({ sessionToken: guest.sessionToken, ready: true });
    store.startRoom(host.sessionToken);
    store.setGame(host.room.code, { status: "finished" });

    expect(store.finishRoom(host.room.code).status).toBe("finished");
    expect(store.getGameMembership(guest.sessionToken).gameState.status).toBe(
      "finished",
    );
    expect(store.leaveRoom(host.sessionToken)).toMatchObject({
      status: "finished",
      players: expect.arrayContaining([
        expect.objectContaining({ id: host.playerId, connected: false }),
      ]),
    });
    expect(store.requireMembership(guest.sessionToken).room.code).toBe("ATCG71");
    expect(store.leaveRoom(guest.sessionToken)).toBeNull();
    expect(() => store.requireMembership(guest.sessionToken)).toThrow(
      "房间身份已经失效",
    );
  });
});
