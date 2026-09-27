import type { GameState, PlayerId } from "../src/game";
import type { RoomSession, RoomStatus, RoomView } from "../src/multiplayer/protocol";

export class RoomError extends Error {}

export interface StoredRoom {
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  players: Array<{
    id: string;
    seat: PlayerId;
    name: string;
    deckId: string;
    ready: boolean;
    connected: boolean;
    socketId: string;
  }>;
  gameState: GameState | null;
  gameRevision: number;
  updatedAt: number;
}

export interface RoomStoreSnapshot {
  schemaVersion: 1;
  savedAt: number;
  rooms: StoredRoom[];
  sessions: Array<{
    sessionToken: string;
    code: string;
    playerId: string;
  }>;
}

export class RoomStore {
  constructor(options?: {
    createId?: () => string;
    createCode?: () => string;
    now?: () => number;
  });
  createRoom(input: {
    playerName: string;
    deckId: string;
    socketId: string;
  }): RoomSession;
  joinRoom(input: {
    roomCode: string;
    playerName: string;
    deckId: string;
    socketId: string;
  }): RoomSession;
  updateRoom(input: {
    sessionToken: string;
    deckId?: string;
    ready?: boolean;
  }): RoomView;
  resumeRoom(input: { sessionToken: string; socketId: string }): RoomView;
  startRoom(sessionToken: string): RoomView;
  setGame(roomCode: string, gameState: GameState): GameState;
  getGameMembership(sessionToken: string): {
    room: StoredRoom;
    player: StoredRoom["players"][number];
    gameState: GameState;
    gameRevision: number;
  };
  updateGame(
    roomCode: string,
    gameState: GameState,
    expectedRevision: number,
  ): { gameState: GameState; gameRevision: number };
  finishRoom(roomCode: string): RoomView;
  leaveRoom(sessionToken: string): RoomView | null;
  disconnectSocket(socketId: string): RoomView[];
  getRoomCode(sessionToken: string): string | null;
  requireMembership(sessionToken: string): {
    room: StoredRoom;
    player: StoredRoom["players"][number];
  };
  requireSocketMembership(sessionToken: string, socketId: string): {
    room: StoredRoom;
    player: StoredRoom["players"][number];
  };
  exportSnapshot(): RoomStoreSnapshot;
  restoreSnapshot(snapshot: RoomStoreSnapshot): void;
  pruneExpired(maxAgeMs: number, now?: number): string[];
  toView(room: StoredRoom): RoomView;
}
