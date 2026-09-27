import { describe, expect, it } from "vitest";
import { gameContent } from "../src/content";
import { createGame } from "../src/game";
import { finishGameByForfeit } from "./gameLifecycle";

function createState() {
  return createGame(gameContent, {
    player1DeckId: gameContent.decks[0].id,
    player2DeckId: gameContent.decks[1].id,
    firstPlayer: "player1",
    seed: "lifecycle-test",
  });
}

describe("联网对局生命周期", () => {
  it("认输后由对手获胜并清除未决交互", () => {
    const initial = createState();
    const finished = finishGameByForfeit(initial, "player1", "concede");

    expect(finished).toMatchObject({
      status: "finished",
      phase: "finished",
      winner: "player2",
      finishReason: "concede",
      currentViewer: "player2",
      handoff: null,
      pendingAttack: null,
      pendingTacticalSupport: null,
      triggerQueue: [],
    });
    expect(initial.status).toBe("mulligan");
    expect(finished.log.at(-1)?.message).toContain("玩家1认输");
  });

  it("对局结束后不能再次改写胜负", () => {
    const finished = finishGameByForfeit(
      createState(),
      "player2",
      "opponent_left",
    );
    expect(() => finishGameByForfeit(finished, "player1", "concede")).toThrow(
      "对局已经结束",
    );
  });
});
