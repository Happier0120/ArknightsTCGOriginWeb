import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import type {
  LobbyResult,
  OnlineGameSnapshot,
  RoomSession,
  RoomView,
} from "../src/multiplayer/protocol";

const children: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) await stopServer(child);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("无法分配测试端口"));
        return;
      }
      const port = address.port;
      reservation.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function startServer(
  port: number,
  statePath: string,
  environment: Record<string, string> = {},
) {
  const child = spawn(
    process.execPath,
    [
      path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("server/index.ts"),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ATCG_SERVER_PORT: String(port),
        ATCG_ROOM_STATE_PATH: statePath,
        ATCG_ROOM_BACKUP_PATH: `${statePath}.bak`,
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  children.push(child);
  let diagnostics = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`测试房间服务提前退出：${diagnostics}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return child;
    } catch {
      // 服务仍在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`测试房间服务启动超时：${diagnostics}`);
}

async function stopServer(child: ChildProcess) {
  const index = children.indexOf(child);
  if (index >= 0) children.splice(index, 1);
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
}

function connectClient(port: number) {
  const socket = io(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    forceNew: true,
    transports: ["websocket"],
  });
  return new Promise<Socket>((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
    socket.connect();
  });
}

function request<T>(socket: Socket, event: string, payload: unknown) {
  return socket.timeout(3_000).emitWithAck(event, payload) as Promise<LobbyResult<T>>;
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate: (value: T) => boolean,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待 ${event} 超时`));
    }, 3_000);
    const handler = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(value);
    };
    socket.on(event, handler);
  });
}

function expectSuccess<T>(result: LobbyResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe("模块7.4.3真实双端完整回归", () => {
  it("贯通开局、隐私、版本、重连、重启、结算与房间释放", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "atcg-e2e-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "rooms.json");
    const port = await getFreePort();
    let server = await startServer(port, statePath);
    let hostSocket = await connectClient(port);
    let guestSocket = await connectClient(port);

    const host = expectSuccess(await request<RoomSession>(hostSocket, "room:create", {
      playerName: "博士A",
      deckId: "RI-MVP",
    }));
    const guest = expectSuccess(await request<RoomSession>(guestSocket, "room:join", {
      roomCode: host.room.code,
      playerName: "博士B",
      deckId: "RM-MVP",
    }));
    expectSuccess(await request<RoomView>(hostSocket, "room:update", {
      sessionToken: host.sessionToken,
      ready: true,
    }));
    expectSuccess(await request<RoomView>(guestSocket, "room:update", {
      sessionToken: guest.sessionToken,
      ready: true,
    }));

    const hostOpening = waitForEvent<OnlineGameSnapshot>(
      hostSocket,
      "game:state",
      (snapshot) => snapshot.revision === 0,
    );
    const guestOpening = waitForEvent<OnlineGameSnapshot>(
      guestSocket,
      "game:state",
      (snapshot) => snapshot.revision === 0,
    );
    expectSuccess(await request<RoomView>(hostSocket, "room:start", {
      sessionToken: host.sessionToken,
    }));
    const [hostView, guestView] = await Promise.all([hostOpening, guestOpening]);
    expect(hostView.state.players.player2.hand.every((id) => id.startsWith("hidden:"))).toBe(true);
    expect(guestView.state.players.player1.hand.every((id) => id.startsWith("hidden:"))).toBe(true);
    expect(hostView.state.players.player1.hand.every(
      (id) => Boolean(hostView.state.cardInstances[id]),
    )).toBe(true);

    const firstMulligan = expectSuccess(await request<OnlineGameSnapshot>(
      hostSocket,
      "game:command",
      {
        sessionToken: host.sessionToken,
        expectedRevision: 0,
        command: {
          type: "SUBMIT_MULLIGAN",
          playerId: "player1",
          cardInstanceIds: [],
        },
      },
    ));
    expect(firstMulligan.revision).toBe(1);
    const duplicate = await request<OnlineGameSnapshot>(hostSocket, "game:command", {
      sessionToken: host.sessionToken,
      expectedRevision: 0,
      command: {
        type: "SUBMIT_MULLIGAN",
        playerId: "player1",
        cardInstanceIds: [],
      },
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: "对局状态已更新，请等待同步后重试",
    });
    const secondMulligan = expectSuccess(await request<OnlineGameSnapshot>(
      guestSocket,
      "game:command",
      {
        sessionToken: guest.sessionToken,
        expectedRevision: 1,
        command: {
          type: "SUBMIT_MULLIGAN",
          playerId: "player2",
          cardInstanceIds: [],
        },
      },
    ));
    expect(secondMulligan).toMatchObject({
      revision: 2,
      state: { status: "playing", activePlayer: "player1" },
    });

    guestSocket.disconnect();
    const guestReconnected = await connectClient(port);
    const resumedGuestState = waitForEvent<OnlineGameSnapshot>(
      guestReconnected,
      "game:state",
      (snapshot) => snapshot.revision === 2,
    );
    const resumedGuestRoom = expectSuccess(await request<RoomView>(
      guestReconnected,
      "room:resume",
      { sessionToken: guest.sessionToken },
    ));
    expect(resumedGuestRoom.players.find((player) => player.id === guest.playerId)?.connected).toBe(true);
    expect((await resumedGuestState).state.players.player1.hand.every(
      (id) => id.startsWith("hidden:"),
    )).toBe(true);

    hostSocket.disconnect();
    guestReconnected.disconnect();
    await stopServer(server);
    server = await startServer(port, statePath);
    hostSocket = await connectClient(port);
    guestSocket = await connectClient(port);
    const restoredHostState = waitForEvent<OnlineGameSnapshot>(
      hostSocket,
      "game:state",
      (snapshot) => snapshot.revision === 2,
    );
    expectSuccess(await request<RoomView>(hostSocket, "room:resume", {
      sessionToken: host.sessionToken,
    }));
    expectSuccess(await request<RoomView>(guestSocket, "room:resume", {
      sessionToken: guest.sessionToken,
    }));
    expect((await restoredHostState).state.status).toBe("playing");

    const guestFinished = waitForEvent<OnlineGameSnapshot>(
      guestSocket,
      "game:state",
      (snapshot) => snapshot.revision === 3 && snapshot.state.status === "finished",
    );
    const conceded = expectSuccess(await request<OnlineGameSnapshot>(
      hostSocket,
      "game:concede",
      { sessionToken: host.sessionToken, expectedRevision: 2 },
    ));
    expect(conceded).toMatchObject({
      revision: 3,
      state: {
        status: "finished",
        winner: "player2",
        finishReason: "concede",
      },
    });
    expect(await guestFinished).toMatchObject({
      revision: 3,
      state: { winner: "player2" },
    });

    expectSuccess(await request<null>(hostSocket, "room:leave", {
      sessionToken: host.sessionToken,
    }));
    expectSuccess(await request<null>(guestSocket, "room:leave", {
      sessionToken: guest.sessionToken,
    }));
    const closed = await request<RoomView>(guestSocket, "room:resume", {
      sessionToken: guest.sessionToken,
    });
    expect(closed).toMatchObject({ ok: false, error: "房间身份已经失效" });

    hostSocket.disconnect();
    guestSocket.disconnect();
    await stopServer(server);
  }, 20_000);

  it("真实服务会对同一来源的入房请求执行限流", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "atcg-rate-limit-"));
    temporaryDirectories.push(directory);
    const statePath = path.join(directory, "rooms.json");
    const port = await getFreePort();
    const server = await startServer(port, statePath, {
      ATCG_ENTRY_RATE_LIMIT: "2",
    });
    const socket = await connectClient(port);

    expectSuccess(await request<RoomSession>(socket, "room:create", {
      playerName: "限流测试A",
      deckId: "RI-MVP",
    }));
    expectSuccess(await request<RoomSession>(socket, "room:create", {
      playerName: "限流测试B",
      deckId: "RI-MVP",
    }));
    const rejected = await request<RoomSession>(socket, "room:create", {
      playerName: "限流测试C",
      deckId: "RI-MVP",
    });

    expect(rejected).toEqual({ ok: false, error: "操作过于频繁，请稍后重试" });
    socket.disconnect();
    await stopServer(server);
  });
});
