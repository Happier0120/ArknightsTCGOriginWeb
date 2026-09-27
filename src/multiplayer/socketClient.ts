import { io, type Socket } from "socket.io-client";
import type {
  CreateRoomInput,
  JoinRoomInput,
  LobbyClient,
  LobbyResult,
  OnlineGameSnapshot,
  RoomSession,
  RoomView,
  UpdateRoomInput,
} from "./protocol";
import type { GameCommand } from "../game";

function request<T>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<LobbyResult<T>> {
  return socket.timeout(5000).emitWithAck(event, payload).catch(() => ({
    ok: false as const,
    error: socket.connected
      ? "房间服务器响应超时，请稍后重试"
      : "未连接到房间服务器，请使用 npm run dev 同时启动页面与房间服务",
  }));
}

export function createSocketLobbyClient(): LobbyClient {
  const socket = io({ autoConnect: false });
  let currentSessionToken: string | null = null;
  let resumeInFlight = false;
  const resume = async (sessionToken: string) => {
    resumeInFlight = true;
    try {
      const result = await request<RoomView>(socket, "room:resume", {
        sessionToken,
      });
      if (
        !result.ok &&
        ["房间身份已经失效", "房间已经关闭"].includes(result.error)
      ) {
        currentSessionToken = null;
      }
      return result;
    } finally {
      resumeInFlight = false;
    }
  };
  socket.on("connect", () => {
    if (!currentSessionToken || resumeInFlight) return;
    void resume(currentSessionToken);
  });
  return {
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
    subscribe: (listener) => {
      socket.on("room:state", listener);
      return () => socket.off("room:state", listener);
    },
    subscribeGame: (listener) => {
      socket.on("game:state", listener);
      return () => socket.off("game:state", listener);
    },
    createRoom: async (input: CreateRoomInput) => {
      const result = await request<RoomSession>(socket, "room:create", input);
      if (result.ok) currentSessionToken = result.data.sessionToken;
      return result;
    },
    joinRoom: async (input: JoinRoomInput) => {
      const result = await request<RoomSession>(socket, "room:join", input);
      if (result.ok) currentSessionToken = result.data.sessionToken;
      return result;
    },
    resumeRoom: async (sessionToken: string) => {
      currentSessionToken = sessionToken;
      return resume(sessionToken);
    },
    updateRoom: (input: UpdateRoomInput) =>
      request<RoomView>(socket, "room:update", input),
    startRoom: (sessionToken: string) =>
      request<RoomView>(socket, "room:start", { sessionToken }),
    sendGameCommand: (
      sessionToken: string,
      expectedRevision: number,
      command: GameCommand,
    ) => request<OnlineGameSnapshot>(socket, "game:command", {
      sessionToken,
      expectedRevision,
      command,
    }),
    concedeGame: (sessionToken: string, expectedRevision: number) =>
      request<OnlineGameSnapshot>(socket, "game:concede", {
        sessionToken,
        expectedRevision,
      }),
    leaveRoom: async (sessionToken: string) => {
      const result = await request<null>(socket, "room:leave", { sessionToken });
      if (result.ok) currentSessionToken = null;
      return result;
    },
  };
}
