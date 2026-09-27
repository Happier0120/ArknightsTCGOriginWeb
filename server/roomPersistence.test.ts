import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameContent } from "../src/content";
import { createGame } from "../src/game";
import { RoomPersistence } from "./roomPersistence";
import { RoomStore } from "./roomStore.mjs";
import { finishGameByForfeit } from "./gameLifecycle";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(now = 1_000) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "atcg-room-store-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "rooms.json");
  const ids = ["player-1", "token-1", "player-2", "token-2"];
  const store = new RoomStore({
    createCode: () => "ATCG73",
    createId: () => ids.shift()!,
    now: () => now,
  });
  const host = store.createRoom({
    playerName: "博士A",
    deckId: gameContent.decks[0].id,
    socketId: "socket-old-1",
  });
  const guest = store.joinRoom({
    roomCode: host.room.code,
    playerName: "博士B",
    deckId: gameContent.decks[1].id,
    socketId: "socket-old-2",
  });
  return { directory, filePath, store, host, guest };
}

describe("房间服务持久化", () => {
  it("原子保存并恢复房间、会话和断线状态", () => {
    const fixture = createFixture();
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 10_000,
      now: () => 1_000,
    });
    persistence.save(fixture.store);

    const restored = new RoomStore({ now: () => 1_100 });
    const result = persistence.load(restored);
    const membership = restored.requireMembership(fixture.host.sessionToken);

    expect(result).toMatchObject({ loaded: true, roomCount: 1, prunedCodes: [] });
    expect(membership.room.code).toBe("ATCG73");
    expect(membership.player).toMatchObject({ connected: false, socketId: "" });
    expect(readdirSync(fixture.directory)).toEqual(["rooms.json"]);
  });

  it("完整恢复服务器权威对局状态", () => {
    const fixture = createFixture();
    fixture.store.updateRoom({ sessionToken: fixture.host.sessionToken, ready: true });
    fixture.store.updateRoom({ sessionToken: fixture.guest.sessionToken, ready: true });
    fixture.store.startRoom(fixture.host.sessionToken);
    const gameState = createGame(gameContent, {
      player1DeckId: gameContent.decks[0].id,
      player2DeckId: gameContent.decks[1].id,
      firstPlayer: "player1",
      seed: "persisted-secret-seed",
    });
    fixture.store.setGame(fixture.host.room.code, gameState);
    fixture.store.updateGame(fixture.host.room.code, gameState, 0);
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 10_000,
      now: () => 1_000,
    });
    persistence.save(fixture.store);

    const restored = new RoomStore({ now: () => 1_100 });
    persistence.load(restored);
    const restoredGame = restored.getGameMembership(fixture.guest.sessionToken);
    expect(restoredGame.gameState).toEqual(gameState);
    expect(restoredGame.gameRevision).toBe(1);
    expect(restoredGame.room.players.every((player) => !player.connected)).toBe(true);
  });

  it("兼容缺少版本号的7.3.3旧快照", () => {
    const fixture = createFixture();
    const snapshot = fixture.store.exportSnapshot();
    const legacySnapshot = {
      ...snapshot,
      rooms: snapshot.rooms.map(({ gameRevision: _revision, ...room }) => room),
    };
    writeFileSync(fixture.filePath, JSON.stringify(legacySnapshot), "utf8");

    const restored = new RoomStore({ now: () => 1_100 });
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 10_000,
      now: () => 1_100,
    });
    persistence.load(restored);

    expect(restored.requireMembership(fixture.host.sessionToken).room.gameRevision).toBe(0);
  });

  it("恢复已结束对局并规范旧快照中的房间状态", () => {
    const fixture = createFixture();
    fixture.store.updateRoom({ sessionToken: fixture.host.sessionToken, ready: true });
    fixture.store.updateRoom({ sessionToken: fixture.guest.sessionToken, ready: true });
    fixture.store.startRoom(fixture.host.sessionToken);
    const gameState = createGame(gameContent, {
      player1DeckId: gameContent.decks[0].id,
      player2DeckId: gameContent.decks[1].id,
      firstPlayer: "player1",
      seed: "finished-persistence-seed",
    });
    const finished = finishGameByForfeit(gameState, "player2", "concede");
    fixture.store.setGame(fixture.host.room.code, finished);
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 10_000,
      now: () => 1_000,
    });
    persistence.save(fixture.store);

    const restored = new RoomStore({ now: () => 1_100 });
    persistence.load(restored);
    const membership = restored.getGameMembership(fixture.host.sessionToken);
    expect(membership.room.status).toBe("finished");
    expect(membership.gameState).toMatchObject({
      status: "finished",
      winner: "player1",
      finishReason: "concede",
    });
  });

  it("启动时清理超过保留期限的房间与会话", () => {
    const fixture = createFixture(1_000);
    const writer = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 500,
      now: () => 1_000,
    });
    writer.save(fixture.store);

    const restored = new RoomStore({ now: () => 2_000 });
    const reader = new RoomPersistence({
      filePath: fixture.filePath,
      maxAgeMs: 500,
      now: () => 2_000,
    });
    const result = reader.load(restored);
    expect(result.prunedCodes).toEqual(["ATCG73"]);
    expect(() => restored.requireMembership(fixture.host.sessionToken)).toThrow(
      "房间身份已经失效",
    );
  });

  it("每次覆盖主快照前保留上一份有效备份", () => {
    const fixture = createFixture();
    const backupPath = path.join(fixture.directory, "rooms.backup.json");
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      backupPath,
      maxAgeMs: 10_000,
      now: () => 1_000,
    });
    persistence.save(fixture.store);
    const original = readFileSync(fixture.filePath, "utf8");

    fixture.store.updateRoom({
      sessionToken: fixture.host.sessionToken,
      ready: true,
    });
    persistence.save(fixture.store);

    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf8")).toBe(original);
  });

  it("主快照损坏时从备份恢复并自动修复主文件", () => {
    const fixture = createFixture();
    const backupPath = path.join(fixture.directory, "rooms.backup.json");
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      backupPath,
      maxAgeMs: 10_000,
      now: () => 1_000,
    });
    persistence.save(fixture.store);
    fixture.store.updateRoom({
      sessionToken: fixture.host.sessionToken,
      ready: true,
    });
    persistence.save(fixture.store);
    writeFileSync(fixture.filePath, "{ damaged", "utf8");

    const restored = new RoomStore({ now: () => 1_100 });
    const result = persistence.load(restored);

    expect(result).toMatchObject({
      loaded: true,
      roomCount: 1,
      recoveredFromBackup: true,
    });
    expect(restored.requireMembership(fixture.host.sessionToken).player.ready).toBe(false);
    expect(() => JSON.parse(readFileSync(fixture.filePath, "utf8"))).not.toThrow();
  });

  it("主快照和备份都损坏时明确拒绝启动", () => {
    const fixture = createFixture();
    const backupPath = path.join(fixture.directory, "rooms.backup.json");
    writeFileSync(fixture.filePath, "{ damaged-primary", "utf8");
    writeFileSync(backupPath, "{ damaged-backup", "utf8");
    const persistence = new RoomPersistence({
      filePath: fixture.filePath,
      backupPath,
      maxAgeMs: 10_000,
    });

    expect(() => persistence.load(new RoomStore())).toThrow(
      "房间主快照与备份快照均无法读取",
    );
  });
});
