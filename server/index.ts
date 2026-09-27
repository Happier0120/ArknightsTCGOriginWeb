import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Server } from "socket.io";
import { z } from "zod";
import contentData from "../src/content/generated/content.json";
import { gameContentSchema } from "../src/content/schema";
import {
  createGame,
  gameCommandSchema,
  type GameState,
} from "../src/game";
import { applyNetworkCommand } from "./networkGame";
import { finishGameByForfeit } from "./gameLifecycle";
import { createPlayerGameView } from "./gameView";
import { RoomError, RoomStore } from "./roomStore.mjs";
import type { StoredRoom } from "./roomStore.mjs";
import { RoomPersistence } from "./roomPersistence";
import type { OnlineGameSnapshot } from "../src/multiplayer/protocol";
import { createStaticClientHandler } from "./staticClient";
import { FixedWindowRateLimiter } from "./rateLimiter";
import { StructuredLogger } from "./logger";

function positiveIntegerEnvironment(name: string, fallback: number) {
  const configured = Number(process.env[name]);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

const port = Number(process.env.ATCG_SERVER_PORT ?? process.env.PORT ?? 4174);
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(serverDirectory, "..");
const serveClient = createStaticClientHandler(path.join(projectDirectory, "dist"));
const roomStatePath = process.env.ATCG_ROOM_STATE_PATH ||
  path.join(serverDirectory, "data", "rooms.json");
const roomStateExtension = path.extname(roomStatePath);
const defaultRoomBackupPath = path.join(
  path.dirname(roomStatePath),
  `${path.basename(roomStatePath, roomStateExtension)}.backup${roomStateExtension || ".json"}`,
);
const roomBackupPath = process.env.ATCG_ROOM_BACKUP_PATH ||
  defaultRoomBackupPath;
const configuredRoomMaxAgeMs = Number(process.env.ATCG_ROOM_MAX_AGE_MS);
const roomMaxAgeMs = Number.isFinite(configuredRoomMaxAgeMs) && configuredRoomMaxAgeMs > 0
  ? configuredRoomMaxAgeMs
  : 24 * 60 * 60 * 1_000;
const socketMaxPayloadBytes = positiveIntegerEnvironment(
  "ATCG_SOCKET_MAX_PAYLOAD_BYTES",
  128 * 1_024,
);
const entryRateLimit = positiveIntegerEnvironment("ATCG_ENTRY_RATE_LIMIT", 12);
const controlRateLimit = positiveIntegerEnvironment("ATCG_CONTROL_RATE_LIMIT", 120);
const commandRateLimit = positiveIntegerEnvironment("ATCG_COMMAND_RATE_LIMIT", 240);
const rateLimitWindowMs = 60_000;
const logger = new StructuredLogger();
const content = gameContentSchema.parse(contentData);
const deckIds = new Set(content.decks.map((deck) => deck.id));
const playerInput = z.object({
  playerName: z.string().trim().min(1, "请输入玩家名称").max(16, "玩家名称最多16个字符"),
  deckId: z.string().refine((value) => deckIds.has(value), "预组不存在"),
});
const createInput = playerInput;
const joinInput = playerInput.extend({
  roomCode: z.string().trim().length(6, "邀请码应为6位"),
});
const updateInput = z.object({
  sessionToken: z.string().min(1),
  deckId: z.string().refine((value) => deckIds.has(value), "预组不存在").optional(),
  ready: z.boolean().optional(),
});
const sessionInput = z.object({ sessionToken: z.string().min(1) });
const gameCommandInput = z.object({
  sessionToken: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
  command: gameCommandSchema,
});
const gameLifecycleInput = z.object({
  sessionToken: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
});

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, module: "8.3" }));
    return;
  }
  if (request.url?.startsWith("/socket.io")) return;
  if (serveClient(request, response)) return;
  response.writeHead(404);
  response.end();
});
const allowedOrigins = (process.env.ATCG_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(httpServer, allowedOrigins.length > 0
  ? {
      cors: { origin: allowedOrigins, credentials: true },
      maxHttpBufferSize: socketMaxPayloadBytes,
    }
  : { maxHttpBufferSize: socketMaxPayloadBytes });
const store = new RoomStore();
const persistence = new RoomPersistence({
  filePath: roomStatePath,
  backupPath: roomBackupPath,
  maxAgeMs: roomMaxAgeMs,
});
let loadResult: ReturnType<RoomPersistence["load"]>;
try {
  loadResult = persistence.load(store);
} catch (error) {
  logger.error("room_snapshot_load_failed", { error });
  throw error;
}
if (loadResult.loaded) {
  logger.info("room_snapshot_restored", {
    roomCount: loadResult.roomCount,
    prunedCount: loadResult.prunedCodes.length,
    recoveredFromBackup: loadResult.recoveredFromBackup,
  });
}

const entryLimiter = new FixedWindowRateLimiter({
  limit: entryRateLimit,
  windowMs: rateLimitWindowMs,
});
const controlLimiter = new FixedWindowRateLimiter({
  limit: controlRateLimit,
  windowMs: rateLimitWindowMs,
});
const commandLimiter = new FixedWindowRateLimiter({
  limit: commandRateLimit,
  windowMs: rateLimitWindowMs,
});

function persistRooms() {
  persistence.save(store);
}

function enforceRateLimit(
  limiter: FixedWindowRateLimiter,
  key: string,
  category: "entry" | "control" | "command",
) {
  const result = limiter.consume(key);
  if (result.allowed) return;
  logger.warn("socket_rate_limited", {
    category,
    retryAfterMs: result.retryAfterMs,
  });
  throw new RoomError("操作过于频繁，请稍后重试");
}

type Ack = (result: { ok: true; data: unknown } | { ok: false; error: string }) => void;

function respond(ack: Ack, operation: () => unknown) {
  if (typeof ack !== "function") return;
  try {
    ack({ ok: true, data: operation() });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues[0]?.message ?? "房间参数无效"
      : error instanceof RoomError || error instanceof Error
        ? error.message
        : "房间操作失败";
    ack({ ok: false, error: message });
  }
}

function broadcast(room: ReturnType<RoomStore["toView"]>) {
  io.to(room.code).emit("room:state", room);
}

function createSnapshot(
  state: GameState,
  revision: number,
  playerId: "player1" | "player2",
): OnlineGameSnapshot {
  return {
    revision,
    state: createPlayerGameView(state, playerId),
  };
}

function broadcastGame(room: StoredRoom, state: GameState) {
  for (const player of room.players) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit(
      "game:state",
      createSnapshot(state, room.gameRevision, player.seat),
    );
  }
}

io.on("connection", (socket) => {
  const forwardedAddress = socket.handshake.headers["x-forwarded-for"];
  const clientAddress = typeof forwardedAddress === "string"
    ? forwardedAddress.split(",")[0]!.trim()
    : socket.handshake.address;

  socket.on("room:create", (payload, ack) => respond(ack, () => {
    enforceRateLimit(entryLimiter, clientAddress, "entry");
    const input = createInput.parse(payload);
    const session = store.createRoom({ ...input, socketId: socket.id });
    persistRooms();
    socket.join(session.room.code);
    broadcast(session.room);
    logger.info("room_created", { roomCode: session.room.code });
    return session;
  }));

  socket.on("room:join", (payload, ack) => respond(ack, () => {
    enforceRateLimit(entryLimiter, clientAddress, "entry");
    const input = joinInput.parse(payload);
    const session = store.joinRoom({ ...input, socketId: socket.id });
    persistRooms();
    socket.join(session.room.code);
    broadcast(session.room);
    logger.info("room_joined", {
      roomCode: session.room.code,
      playerCount: session.room.players.length,
    });
    return session;
  }));

  socket.on("room:update", (payload, ack) => respond(ack, () => {
    enforceRateLimit(controlLimiter, socket.id, "control");
    const input = updateInput.parse(payload);
    store.requireSocketMembership(input.sessionToken, socket.id);
    const room = store.updateRoom(input);
    persistRooms();
    broadcast(room);
    return room;
  }));

  socket.on("room:resume", (payload, ack) => respond(ack, () => {
    enforceRateLimit(entryLimiter, clientAddress, "entry");
    const { sessionToken } = sessionInput.parse(payload);
    const room = store.resumeRoom({ sessionToken, socketId: socket.id });
    persistRooms();
    socket.join(room.code);
    broadcast(room);
    if (room.status === "started" || room.status === "finished") {
      const { gameState, gameRevision, player } = store.getGameMembership(sessionToken);
      socket.emit(
        "game:state",
        createSnapshot(gameState, gameRevision, player.seat),
      );
    }
    return room;
  }));

  socket.on("room:start", (payload, ack) => respond(ack, () => {
    enforceRateLimit(controlLimiter, socket.id, "control");
    const { sessionToken } = sessionInput.parse(payload);
    store.requireSocketMembership(sessionToken, socket.id);
    const room = store.startRoom(sessionToken);
    const [player1, player2] = room.players;
    if (!player1 || !player2) throw new RoomError("需要两名玩家才能开始");
    const gameState = createGame(content, {
      player1DeckId: player1.deckId,
      player2DeckId: player2.deckId,
      firstPlayer: "player1",
      seed: randomUUID(),
    });
    store.setGame(room.code, gameState);
    persistRooms();
    broadcast(room);
    const { room: storedRoom } = store.getGameMembership(sessionToken);
    broadcastGame(storedRoom, gameState);
    logger.info("game_started", { roomCode: room.code });
    return room;
  }));

  socket.on("game:command", (payload, ack) => respond(ack, () => {
    enforceRateLimit(commandLimiter, socket.id, "command");
    const { sessionToken, expectedRevision, command } = gameCommandInput.parse(payload);
    store.requireSocketMembership(sessionToken, socket.id);
    const { room, player, gameState, gameRevision } = store.getGameMembership(sessionToken);
    if (command.playerId !== player.seat) {
      throw new RoomError("不能替另一名玩家执行操作");
    }
    if (expectedRevision !== gameRevision) {
      throw new RoomError("对局状态已更新，请等待同步后重试");
    }
    const nextState = applyNetworkCommand(gameState, command, content);
    const updated = store.updateGame(room.code, nextState, expectedRevision);
    let finishedRoom: ReturnType<RoomStore["toView"]> | null = null;
    if (nextState.status === "finished") {
      finishedRoom = store.finishRoom(room.code);
    }
    persistRooms();
    broadcastGame(room, nextState);
    if (finishedRoom) broadcast(finishedRoom);
    if (finishedRoom) {
      logger.info("game_finished", {
        roomCode: room.code,
        reason: nextState.finishReason,
        revision: updated.gameRevision,
      });
    }
    return createSnapshot(nextState, updated.gameRevision, player.seat);
  }));

  socket.on("game:concede", (payload, ack) => respond(ack, () => {
    enforceRateLimit(commandLimiter, socket.id, "command");
    const { sessionToken, expectedRevision } = gameLifecycleInput.parse(payload);
    store.requireSocketMembership(sessionToken, socket.id);
    const { room, player, gameState, gameRevision } =
      store.getGameMembership(sessionToken);
    if (room.status === "finished" || gameState.status === "finished") {
      throw new RoomError("对局已经结束");
    }
    if (expectedRevision !== gameRevision) {
      throw new RoomError("对局状态已更新，请等待同步后重试");
    }
    const nextState = finishGameByForfeit(gameState, player.seat, "concede");
    const updated = store.updateGame(room.code, nextState, expectedRevision);
    const finishedRoom = store.finishRoom(room.code);
    persistRooms();
    broadcastGame(room, nextState);
    broadcast(finishedRoom);
    logger.info("game_finished", {
      roomCode: room.code,
      reason: "concede",
      revision: updated.gameRevision,
    });
    return createSnapshot(nextState, updated.gameRevision, player.seat);
  }));

  socket.on("room:leave", (payload, ack) => respond(ack, () => {
    enforceRateLimit(controlLimiter, socket.id, "control");
    const { sessionToken } = sessionInput.parse(payload);
    const membership = store.requireSocketMembership(sessionToken, socket.id);
    const code = store.getRoomCode(sessionToken);
    let departureGame: GameState | null = null;
    if (membership.room.status === "started") {
      const { room, player, gameState, gameRevision } =
        store.getGameMembership(sessionToken);
      departureGame = finishGameByForfeit(
        gameState,
        player.seat,
        "opponent_left",
      );
      store.updateGame(room.code, departureGame, gameRevision);
      store.finishRoom(room.code);
    }
    const room = store.leaveRoom(sessionToken);
    persistRooms();
    if (code) socket.leave(code);
    if (departureGame) {
      broadcastGame(membership.room, departureGame);
    }
    if (room) broadcast(room);
    return null;
  }));

  socket.on("disconnect", () => {
    controlLimiter.delete(socket.id);
    commandLimiter.delete(socket.id);
    const rooms = store.disconnectSocket(socket.id);
    if (rooms.length > 0) persistRooms();
    for (const room of rooms) broadcast(room);
  });
});

const cleanupTimer = setInterval(() => {
  const removedCodes = store.pruneExpired(roomMaxAgeMs);
  if (removedCodes.length > 0) persistRooms();
}, Math.min(roomMaxAgeMs, 15 * 60 * 1_000));
cleanupTimer.unref();

const rateLimitCleanupTimer = setInterval(() => {
  entryLimiter.pruneExpired();
  controlLimiter.pruneExpired();
  commandLimiter.pruneExpired();
}, rateLimitWindowMs);
rateLimitCleanupTimer.unref();

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer);
  clearInterval(rateLimitCleanupTimer);
  logger.info("shutdown_started", { signal });
  let exitCode = 0;
  try {
    persistRooms();
  } catch (error) {
    exitCode = 1;
    logger.error("shutdown_persistence_failed", { error });
  }
  const forceExitTimer = setTimeout(() => process.exit(1), 10_000);
  forceExitTimer.unref();
  io.close(() => {
    clearTimeout(forceExitTimer);
    process.exit(exitCode);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

httpServer.listen(port, "0.0.0.0", () => {
  const address = httpServer.address();
  const listeningPort = address && typeof address !== "string" ? address.port : port;
  logger.info("server_listening", {
    host: "0.0.0.0",
    port: listeningPort,
    maxPayloadBytes: socketMaxPayloadBytes,
  });
});
