import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { gameStateSchema } from "../src/game/schema";
import type { RoomStoreSnapshot } from "./roomStore.mjs";
import { RoomStore } from "./roomStore.mjs";

const storedPlayerSchema = z.object({
  id: z.string().min(1),
  seat: z.enum(["player1", "player2"]),
  name: z.string().min(1).max(16),
  deckId: z.string().min(1),
  ready: z.boolean(),
  connected: z.boolean(),
  socketId: z.string(),
});

const storedRoomSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{6}$/),
  hostPlayerId: z.string().min(1),
  status: z.enum(["waiting", "ready", "started", "finished"]),
  players: z.array(storedPlayerSchema).min(1).max(2),
  gameState: gameStateSchema.nullable(),
  gameRevision: z.number().int().nonnegative().default(0),
  updatedAt: z.number().int().nonnegative(),
}).superRefine((room, context) => {
  if (!room.players.some((player) => player.id === room.hostPlayerId)) {
    context.addIssue({ code: "custom", message: "房主不在房间玩家列表中" });
  }
  if (["started", "finished"].includes(room.status) && !room.gameState) {
    context.addIssue({ code: "custom", message: "已开始房间缺少对局状态" });
  }
  if (room.status === "finished" && room.gameState?.status !== "finished") {
    context.addIssue({ code: "custom", message: "已结束房间的对局状态尚未结束" });
  }
});

const roomStoreSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  savedAt: z.number().int().nonnegative(),
  rooms: z.array(storedRoomSchema),
  sessions: z.array(z.object({
    sessionToken: z.string().min(1),
    code: z.string().regex(/^[A-Z0-9]{6}$/),
    playerId: z.string().min(1),
  })),
}).superRefine((snapshot, context) => {
  const roomCodes = new Set(snapshot.rooms.map((room) => room.code));
  if (roomCodes.size !== snapshot.rooms.length) {
    context.addIssue({ code: "custom", message: "房间邀请码必须唯一" });
  }
  const tokens = new Set(snapshot.sessions.map((session) => session.sessionToken));
  if (tokens.size !== snapshot.sessions.length) {
    context.addIssue({ code: "custom", message: "会话令牌必须唯一" });
  }
});

export interface RoomPersistenceOptions {
  filePath: string;
  backupPath?: string;
  maxAgeMs: number;
  now?: () => number;
}

export class RoomPersistence {
  private readonly filePath: string;
  private readonly backupPath: string;
  private readonly maxAgeMs: number;
  private readonly now: () => number;

  constructor({
    filePath,
    backupPath = `${filePath}.bak`,
    maxAgeMs,
    now = Date.now,
  }: RoomPersistenceOptions) {
    if (path.resolve(filePath) === path.resolve(backupPath)) {
      throw new Error("房间主快照和备份快照不能使用同一路径");
    }
    this.filePath = filePath;
    this.backupPath = backupPath;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }

  load(store: RoomStore) {
    if (!existsSync(this.filePath) && !existsSync(this.backupPath)) {
      return {
        loaded: false,
        roomCount: 0,
        prunedCodes: [] as string[],
        recoveredFromBackup: false,
      };
    }

    let snapshot: RoomStoreSnapshot;
    let recoveredFromBackup = false;
    try {
      snapshot = this.readSnapshot(this.filePath);
    } catch (primaryError) {
      try {
        snapshot = this.readSnapshot(this.backupPath);
        recoveredFromBackup = true;
      } catch (backupError) {
        throw new AggregateError(
          [primaryError, backupError],
          "房间主快照与备份快照均无法读取",
        );
      }
    }

    store.restoreSnapshot(snapshot);
    const prunedCodes = store.pruneExpired(this.maxAgeMs, this.now());
    if (recoveredFromBackup) {
      this.writeSnapshot(this.filePath, store.exportSnapshot());
    } else if (prunedCodes.length > 0) {
      this.save(store);
    }
    return {
      loaded: true,
      roomCount: snapshot.rooms.length - prunedCodes.length,
      prunedCodes,
      recoveredFromBackup,
    };
  }

  save(store: RoomStore) {
    const snapshot = store.exportSnapshot();
    roomStoreSnapshotSchema.parse(snapshot);

    if (existsSync(this.filePath)) {
      try {
        const previousSnapshot = this.readSnapshot(this.filePath);
        this.writeSnapshot(this.backupPath, previousSnapshot);
      } catch {
        // 保留上一份有效备份，避免用已经损坏的主快照覆盖它。
      }
    }
    this.writeSnapshot(this.filePath, snapshot);
  }

  private readSnapshot(filePath: string) {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return roomStoreSnapshotSchema.parse(parsed) as RoomStoreSnapshot;
  }

  private writeSnapshot(filePath: string, snapshot: RoomStoreSnapshot) {
    roomStoreSnapshotSchema.parse(snapshot);
    const directory = path.dirname(filePath);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${this.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      renameSync(temporaryPath, filePath);
    } finally {
      if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
  }
}
