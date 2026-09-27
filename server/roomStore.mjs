import { randomUUID } from "node:crypto";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomError extends Error {}

function defaultRoomCode() {
  return Array.from({ length: 6 }, () =>
    ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)],
  ).join("");
}

export class RoomStore {
  constructor({
    createId = randomUUID,
    createCode = defaultRoomCode,
    now = Date.now,
  } = {}) {
    this.createId = createId;
    this.createCode = createCode;
    this.now = now;
    this.rooms = new Map();
    this.sessions = new Map();
  }

  createRoom({ playerName, deckId, socketId }) {
    let code = this.createCode();
    while (this.rooms.has(code)) code = this.createCode();
    const playerId = this.createId();
    const sessionToken = this.createId();
    const player = {
      id: playerId,
      seat: "player1",
      name: playerName,
      deckId,
      ready: false,
      connected: true,
      socketId,
    };
    const room = {
      code,
      hostPlayerId: playerId,
      status: "waiting",
      players: [player],
      gameState: null,
      gameRevision: 0,
      updatedAt: this.now(),
    };
    this.rooms.set(code, room);
    this.sessions.set(sessionToken, { code, playerId });
    return { playerId, sessionToken, room: this.toView(room) };
  }

  joinRoom({ roomCode, playerName, deckId, socketId }) {
    const code = roomCode.trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("房间不存在或已经关闭");
    if (room.status === "started") throw new RoomError("对局已经开始");
    if (room.status === "finished") throw new RoomError("对局已经结束");
    if (room.players.length >= 2) throw new RoomError("房间已满");
    const playerId = this.createId();
    const sessionToken = this.createId();
    room.players.push({
      id: playerId,
      seat: "player2",
      name: playerName,
      deckId,
      ready: false,
      connected: true,
      socketId,
    });
    this.touch(room);
    this.refreshStatus(room);
    this.sessions.set(sessionToken, { code, playerId });
    return { playerId, sessionToken, room: this.toView(room) };
  }

  updateRoom({ sessionToken, deckId, ready }) {
    const { room, player } = this.requireMembership(sessionToken);
    if (room.status === "started") throw new RoomError("对局已经开始，不能修改房间");
    if (room.status === "finished") throw new RoomError("对局已经结束，不能修改房间");
    if (deckId !== undefined) player.deckId = deckId;
    if (ready !== undefined) player.ready = ready;
    this.touch(room);
    this.refreshStatus(room);
    return this.toView(room);
  }

  resumeRoom({ sessionToken, socketId }) {
    const { room, player } = this.requireMembership(sessionToken);
    player.socketId = socketId;
    player.connected = true;
    this.touch(room);
    this.refreshStatus(room);
    return this.toView(room);
  }

  startRoom(sessionToken) {
    const { room, player } = this.requireMembership(sessionToken);
    if (room.status === "started") throw new RoomError("对局已经开始");
    if (room.status === "finished") throw new RoomError("对局已经结束");
    if (room.hostPlayerId !== player.id) throw new RoomError("只有房主可以开始对局");
    if (room.players.length !== 2) throw new RoomError("需要两名玩家才能开始");
    if (room.players.some((candidate) => !candidate.ready || !candidate.connected)) {
      throw new RoomError("双方在线并准备后才能开始");
    }
    room.status = "started";
    this.touch(room);
    return this.toView(room);
  }

  setGame(roomCode, gameState) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new RoomError("房间已经关闭");
    room.gameState = gameState;
    room.gameRevision = 0;
    this.touch(room);
    return gameState;
  }

  getGameMembership(sessionToken) {
    const { room, player } = this.requireMembership(sessionToken);
    if (!["started", "finished"].includes(room.status) || !room.gameState) {
      throw new RoomError("房间尚未开始对局");
    }
    return {
      room,
      player,
      gameState: room.gameState,
      gameRevision: room.gameRevision,
    };
  }

  updateGame(roomCode, gameState, expectedRevision) {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== "started") {
      throw new RoomError("房间已经关闭");
    }
    if (room.gameRevision !== expectedRevision) {
      throw new RoomError("对局状态已更新，请等待同步后重试");
    }
    room.gameState = gameState;
    room.gameRevision += 1;
    this.touch(room);
    return { gameState, gameRevision: room.gameRevision };
  }

  finishRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) throw new RoomError("房间已经关闭");
    if (room.gameState.status !== "finished") {
      throw new RoomError("对局尚未结束");
    }
    room.status = "finished";
    this.touch(room);
    return this.toView(room);
  }

  leaveRoom(sessionToken) {
    const membership = this.sessions.get(sessionToken);
    if (!membership) throw new RoomError("房间身份已经失效");
    const room = this.rooms.get(membership.code);
    this.sessions.delete(sessionToken);
    if (!room) return null;
    if (room.status === "started" || room.status === "finished") {
      const leavingPlayer = room.players.find(
        (player) => player.id === membership.playerId,
      );
      if (leavingPlayer) {
        leavingPlayer.connected = false;
        leavingPlayer.socketId = "";
      }
      this.touch(room);
      if (
        room.status === "finished" &&
        !room.players.some((player) =>
          [...this.sessions.values()].some(
            (session) => session.code === room.code && session.playerId === player.id,
          )
        )
      ) {
        this.rooms.delete(room.code);
        return null;
      }
      return this.toView(room);
    }
    room.players = room.players.filter(
      (player) => player.id !== membership.playerId,
    );
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
      return null;
    }
    if (room.hostPlayerId === membership.playerId) {
      room.hostPlayerId = room.players[0].id;
      room.players[0].seat = "player1";
    }
    room.players[0].ready = false;
    this.touch(room);
    this.refreshStatus(room);
    return this.toView(room);
  }

  disconnectSocket(socketId) {
    const changed = [];
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (!player) continue;
      player.connected = false;
      this.refreshStatus(room);
      changed.push(this.toView(room));
    }
    return changed;
  }

  getRoomCode(sessionToken) {
    return this.sessions.get(sessionToken)?.code ?? null;
  }

  requireMembership(sessionToken) {
    const membership = this.sessions.get(sessionToken);
    if (!membership) throw new RoomError("房间身份已经失效");
    const room = this.rooms.get(membership.code);
    const player = room?.players.find(
      (candidate) => candidate.id === membership.playerId,
    );
    if (!room || !player) throw new RoomError("房间已经关闭");
    return { room, player };
  }

  requireSocketMembership(sessionToken, socketId) {
    const membership = this.requireMembership(sessionToken);
    if (
      !membership.player.connected ||
      membership.player.socketId !== socketId
    ) {
      throw new RoomError("当前连接已被新的会话替代");
    }
    return membership;
  }

  exportSnapshot() {
    return {
      schemaVersion: 1,
      savedAt: this.now(),
      rooms: [...this.rooms.values()].map((room) => ({
        ...structuredClone(room),
        players: room.players.map((player) => ({
          ...structuredClone(player),
          connected: false,
          socketId: "",
        })),
      })),
      sessions: [...this.sessions.entries()].map(([sessionToken, membership]) => ({
        sessionToken,
        ...membership,
      })),
    };
  }

  restoreSnapshot(snapshot) {
    this.rooms = new Map(
      snapshot.rooms.map((room) => [room.code, {
        ...structuredClone(room),
        status: room.gameState?.status === "finished" ? "finished" : room.status,
        gameRevision: room.gameRevision ?? 0,
        players: room.players.map((player) => ({
          ...structuredClone(player),
          connected: false,
          socketId: "",
        })),
      }]),
    );
    this.sessions = new Map();
    for (const membership of snapshot.sessions) {
      const room = this.rooms.get(membership.code);
      if (!room?.players.some((player) => player.id === membership.playerId)) {
        continue;
      }
      this.sessions.set(membership.sessionToken, {
        code: membership.code,
        playerId: membership.playerId,
      });
    }
  }

  pruneExpired(maxAgeMs, now = this.now()) {
    const removedCodes = [];
    for (const [code, room] of this.rooms) {
      if (room.players.some((player) => player.connected)) continue;
      if (now - room.updatedAt <= maxAgeMs) continue;
      this.rooms.delete(code);
      removedCodes.push(code);
    }
    if (removedCodes.length > 0) {
      const removed = new Set(removedCodes);
      for (const [token, membership] of this.sessions) {
        if (removed.has(membership.code)) this.sessions.delete(token);
      }
    }
    return removedCodes;
  }

  touch(room) {
    room.updatedAt = this.now();
  }

  refreshStatus(room) {
    if (room.status === "started" || room.status === "finished") return;
    room.status =
      room.players.length === 2 &&
      room.players.every((player) => player.ready && player.connected)
        ? "ready"
        : "waiting";
  }

  toView(room) {
    return {
      code: room.code,
      status: room.status,
      players: room.players.map((player) => ({
        id: player.id,
        seat: player.seat,
        name: player.name,
        deckId: player.deckId,
        ready: player.ready,
        connected: player.connected,
        isHost: player.id === room.hostPlayerId,
      })),
    };
  }
}
