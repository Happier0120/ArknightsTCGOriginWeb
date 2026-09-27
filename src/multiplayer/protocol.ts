import type { GameCommand, GameState } from "../game";

export type RoomStatus = "waiting" | "ready" | "started" | "finished";
export type RoomSeat = "player1" | "player2";

export interface RoomPlayerView {
  id: string;
  seat: RoomSeat;
  name: string;
  deckId: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  players: RoomPlayerView[];
}

export interface RoomSession {
  playerId: string;
  sessionToken: string;
  room: RoomView;
}

export type LobbyResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface OnlineGameSnapshot {
  revision: number;
  state: GameState;
}

export function chooseLatestGameSnapshot(
  current: OnlineGameSnapshot | null,
  incoming: OnlineGameSnapshot,
) {
  return current && incoming.revision < current.revision ? current : incoming;
}

export interface CreateRoomInput {
  playerName: string;
  deckId: string;
}

export interface JoinRoomInput extends CreateRoomInput {
  roomCode: string;
}

export interface UpdateRoomInput {
  sessionToken: string;
  deckId?: string;
  ready?: boolean;
}

export interface LobbyClient {
  connect: () => void;
  disconnect: () => void;
  subscribe: (listener: (room: RoomView) => void) => () => void;
  subscribeGame: (listener: (snapshot: OnlineGameSnapshot) => void) => () => void;
  createRoom: (input: CreateRoomInput) => Promise<LobbyResult<RoomSession>>;
  joinRoom: (input: JoinRoomInput) => Promise<LobbyResult<RoomSession>>;
  resumeRoom: (sessionToken: string) => Promise<LobbyResult<RoomView>>;
  updateRoom: (input: UpdateRoomInput) => Promise<LobbyResult<RoomView>>;
  startRoom: (sessionToken: string) => Promise<LobbyResult<RoomView>>;
  sendGameCommand: (
    sessionToken: string,
    expectedRevision: number,
    command: GameCommand,
  ) => Promise<LobbyResult<OnlineGameSnapshot>>;
  concedeGame: (
    sessionToken: string,
    expectedRevision: number,
  ) => Promise<LobbyResult<OnlineGameSnapshot>>;
  leaveRoom: (sessionToken: string) => Promise<LobbyResult<null>>;
}
