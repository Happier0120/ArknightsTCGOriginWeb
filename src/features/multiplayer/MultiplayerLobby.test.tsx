// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameContent } from "../../content";
import type { LobbyClient, RoomSession, RoomView } from "../../multiplayer/protocol";
import {
  loadRoomSession,
  saveRoomSession,
} from "../../multiplayer/sessionStorage";
import { MultiplayerLobby } from "./MultiplayerLobby";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function hostRoom(overrides: Partial<RoomView> = {}): RoomView {
  return {
    code: "ATCG71",
    status: "waiting",
    players: [
      {
        id: "player-1",
        seat: "player1",
        name: "博士A",
        deckId: gameContent.decks[0].id,
        ready: false,
        connected: true,
        isHost: true,
      },
    ],
    ...overrides,
  };
}

function createClient() {
  let listener: ((room: RoomView) => void) | undefined;
  const session: RoomSession = {
    playerId: "player-1",
    sessionToken: "token-1",
    room: hostRoom(),
  };
  const client: LobbyClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return vi.fn();
    }),
    subscribeGame: vi.fn(() => vi.fn()),
    createRoom: vi.fn(async () => ({ ok: true as const, data: session })),
    joinRoom: vi.fn(async () => ({ ok: false as const, error: "房间不存在" })),
    resumeRoom: vi.fn(async () => ({ ok: false as const, error: "房间身份已经失效" })),
    updateRoom: vi.fn(async () => ({ ok: true as const, data: hostRoom() })),
    startRoom: vi.fn(async () => ({
      ok: true as const,
      data: hostRoom({ status: "started" }),
    })),
    sendGameCommand: vi.fn(async (_sessionToken, _expectedRevision, _command) => ({
      ok: false as const,
      error: "对局尚未开始",
    })),
    concedeGame: vi.fn(async () => ({
      ok: false as const,
      error: "对局尚未开始",
    })),
    leaveRoom: vi.fn(async () => ({ ok: true as const, data: null })),
  };
  return { client, emitRoom: (room: RoomView) => listener?.(room) };
}

describe("双人房间大厅", () => {
  it("刷新后使用当前标签页保存的身份恢复房间", async () => {
    const { client } = createClient();
    saveRoomSession(window.sessionStorage, {
      playerId: "player-1",
      sessionToken: "token-1",
      roomCode: "ATCG71",
    });
    client.resumeRoom = vi.fn(async () => ({
      ok: true as const,
      data: hostRoom(),
    }));

    render(<MultiplayerLobby decks={gameContent.decks} client={client} />);

    expect(await screen.findByRole("heading", { name: /邀请码 ATCG71/ })).toBeTruthy();
    expect(client.resumeRoom).toHaveBeenCalledWith("token-1");
  });

  it("身份失效时清除保存并返回大厅", async () => {
    const { client } = createClient();
    saveRoomSession(window.sessionStorage, {
      playerId: "player-1",
      sessionToken: "expired-token",
      roomCode: "ATCG71",
    });

    render(<MultiplayerLobby decks={gameContent.decks} client={client} />);

    expect(await screen.findByRole("heading", { name: "创建或加入对战房间" })).toBeTruthy();
    expect(loadRoomSession(window.sessionStorage)).toBeNull();
  });

  it("创建房间后显示邀请码、席位与等待提示", async () => {
    const user = userEvent.setup();
    const { client } = createClient();
    render(<MultiplayerLobby decks={gameContent.decks} client={client} />);

    await user.clear(screen.getByLabelText("玩家名称"));
    await user.type(screen.getByLabelText("玩家名称"), "博士A");
    await user.click(screen.getByRole("button", { name: "创建房间" }));

    expect(client.createRoom).toHaveBeenCalledWith({
      playerName: "博士A",
      deckId: gameContent.decks[0].id,
    });
    expect(screen.getByRole("heading", { name: /邀请码 ATCG71/ })).toBeTruthy();
    expect(screen.getByText("等待另一名玩家")).toBeTruthy();
  });

  it("双方准备后房主可以开始房间", async () => {
    const user = userEvent.setup();
    const { client, emitRoom } = createClient();
    render(<MultiplayerLobby decks={gameContent.decks} client={client} />);
    await user.click(screen.getByRole("button", { name: "创建房间" }));

    const readyRoom = hostRoom({
      status: "ready",
      players: [
        { ...hostRoom().players[0], ready: true },
        {
          id: "player-2",
          seat: "player2",
          name: "博士B",
          deckId: gameContent.decks[1].id,
          ready: true,
          connected: true,
          isHost: false,
        },
      ],
    });
    act(() => emitRoom(readyRoom));

    const startButton = await screen.findByRole("button", { name: "开始对局" });
    expect(startButton.hasAttribute("disabled")).toBe(false);
    await user.click(startButton);

    expect(client.startRoom).toHaveBeenCalledWith("token-1");
    expect(await screen.findByText("正在创建服务器对局")).toBeTruthy();
  });

  it("离开失败时保留当前房间并显示错误", async () => {
    const user = userEvent.setup();
    const { client } = createClient();
    client.leaveRoom = vi.fn(async () => ({
      ok: false as const,
      error: "暂时无法离开",
    }));
    render(<MultiplayerLobby decks={gameContent.decks} client={client} />);
    await user.click(screen.getByRole("button", { name: "创建房间" }));

    await user.click(screen.getByRole("button", { name: "离开房间" }));
    expect((await screen.findByRole("alert")).textContent).toContain("暂时无法离开");
    expect(screen.getByRole("heading", { name: /邀请码 ATCG71/ })).toBeTruthy();
  });
});
