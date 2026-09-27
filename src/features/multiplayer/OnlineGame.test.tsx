// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameContent } from "../../content";
import {
  applyGameCommand,
  createGame,
  type GameCommand,
  type GameState,
} from "../../game";
import { OnlineGame } from "./OnlineGame";

afterEach(cleanup);

function initialState() {
  return createGame(gameContent, {
    player1DeckId: gameContent.decks[0].id,
    player2DeckId: gameContent.decks[1].id,
    firstPlayer: "player1",
    seed: "online-game-ui-test",
  });
}

function playingState(): GameState {
  let state = initialState();
  const commands: GameCommand[] = [
    { type: "SUBMIT_MULLIGAN", playerId: "player1", cardInstanceIds: [] },
    { type: "CONFIRM_HANDOFF", playerId: "player2" },
    { type: "SUBMIT_MULLIGAN", playerId: "player2", cardInstanceIds: [] },
    { type: "CONFIRM_HANDOFF", playerId: "player1" },
  ];
  for (const command of commands) {
    const result = applyGameCommand(state, command, gameContent);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

function renderOnline(
  state: GameState,
  playerId: "player1" | "player2",
  callbacks: { onConcede?: () => void; onLeave?: () => void } = {},
) {
  return render(
    <OnlineGame
      commandPending={false}
      onCommand={vi.fn()}
      onConcede={callbacks.onConcede ?? vi.fn()}
      onLeave={callbacks.onLeave ?? vi.fn()}
      opponentConnected
      opponentName={playerId === "player1" ? "玩家乙" : "玩家甲"}
      playerId={playerId}
      playerName={playerId === "player1" ? "玩家甲" : "玩家乙"}
      roomCode="ATCG72"
      revision={2}
      state={state}
    />,
  );
}

describe("联网对局界面", () => {
  it("只向当前调度玩家显示起手选择", () => {
    const state = initialState();
    const player1 = renderOnline(state, "player1");
    expect(screen.getByRole("heading", { name: "玩家1：起手调度" })).toBeTruthy();
    player1.unmount();

    renderOnline(state, "player2");
    expect(screen.getByRole("heading", { name: "等待对手完成起手调度" })).toBeTruthy();
    expect(screen.queryByText("玩家1：起手调度")).toBeNull();
  });

  it("非当前玩家从本人视角查看台面且不能推进阶段", () => {
    renderOnline(playingState(), "player2");

    expect(screen.getByLabelText("玩家2手牌")).toBeTruthy();
    const waitingButton = screen.getByRole("button", { name: "等待对手操作" });
    expect(waitingButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("同步 r2")).toBeTruthy();
  });

  it("认输需要二次确认", async () => {
    const user = userEvent.setup();
    const onConcede = vi.fn();
    renderOnline(playingState(), "player1", { onConcede });

    await user.click(screen.getByRole("button", { name: "认输" }));
    expect(onConcede).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认认输" }));
    expect(onConcede).toHaveBeenCalledOnce();
  });

  it("以本人视角展示胜负原因并允许返回大厅", async () => {
    const user = userEvent.setup();
    const state = playingState();
    state.status = "finished";
    state.phase = "finished";
    state.winner = "player1";
    state.finishReason = "concede";
    const onLeave = vi.fn();
    renderOnline(state, "player1", { onLeave });

    expect(screen.getByRole("heading", { name: "你获得胜利" })).toBeTruthy();
    expect(screen.getByText("玩家乙选择认输。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回对战大厅" }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
