import { describe, expect, it } from "vitest";
import { gameContent } from "../src/content";
import { createGame } from "../src/game";
import { applyNetworkCommand } from "./networkGame";

function createState() {
  return createGame(gameContent, {
    player1DeckId: gameContent.decks[0].id,
    player2DeckId: gameContent.decks[1].id,
    firstPlayer: "player1",
    seed: "module-7-2-network-test",
  });
}

describe("联网对局自动交接", () => {
  it("玩家1调度后直接把操作权切给玩家2", () => {
    const next = applyNetworkCommand(
      createState(),
      { type: "SUBMIT_MULLIGAN", playerId: "player1", cardInstanceIds: [] },
      gameContent,
    );

    expect(next.status).toBe("mulligan");
    expect(next.currentViewer).toBe("player2");
    expect(next.handoff).toBeNull();
  });

  it("双方调度完成后自动开始先手玩家的准备阶段", () => {
    const afterPlayer1 = applyNetworkCommand(
      createState(),
      { type: "SUBMIT_MULLIGAN", playerId: "player1", cardInstanceIds: [] },
      gameContent,
    );
    const afterPlayer2 = applyNetworkCommand(
      afterPlayer1,
      { type: "SUBMIT_MULLIGAN", playerId: "player2", cardInstanceIds: [] },
      gameContent,
    );

    expect(afterPlayer2).toMatchObject({
      status: "playing",
      phase: "ready",
      activePlayer: "player1",
      currentViewer: "player1",
      turnNumber: 1,
      handoff: null,
    });
  });

  it("拒绝不符合当前规则状态的玩家指令", () => {
    expect(() => applyNetworkCommand(
      createState(),
      { type: "SUBMIT_MULLIGAN", playerId: "player2", cardInstanceIds: [] },
      gameContent,
    )).toThrow("当前不能由该玩家进行调度");
  });
});
