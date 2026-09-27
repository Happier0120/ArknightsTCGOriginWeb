import { describe, expect, it } from "vitest";
import { gameContent } from "../src/content";
import { createGame } from "../src/game";
import { createPlayerGameView } from "./gameView";

function createState() {
  return createGame(gameContent, {
    player1DeckId: gameContent.decks[0].id,
    player2DeckId: gameContent.decks[1].id,
    firstPlayer: "player1",
    seed: "private-server-seed",
  });
}

describe("玩家专属对局视图", () => {
  it("保留自己的手牌定义并隐藏对手手牌、牌库与随机种子", () => {
    const state = createState();
    const opponentSecretIds = new Set([
      ...state.players.player2.hand,
      ...state.players.player2.drawPile,
    ]);
    const view = createPlayerGameView(state, "player1");

    expect(view.players.player1.hand).toEqual(state.players.player1.hand);
    expect(view.players.player1.hand.every((id) => view.cardInstances[id])).toBe(true);
    expect(view.players.player1.drawPile.every((id) => id.startsWith("hidden:player1:deck:"))).toBe(true);
    expect(state.players.player1.drawPile.some((id) => view.cardInstances[id])).toBe(false);
    expect(view.players.player2.hand).toHaveLength(5);
    expect(view.players.player2.hand.every((id) => id.startsWith("hidden:player2:hand:"))).toBe(true);
    expect(view.players.player2.drawPile.every((id) => id.startsWith("hidden:player2:deck:"))).toBe(true);
    expect(Object.keys(view.cardInstances).some((id) => opponentSecretIds.has(id))).toBe(false);
    expect(view.seed).toBe("server-secret");
    expect(view.rngState).toBe(0);
  });

  it("保留对手公开区域中的卡牌定义", () => {
    const state = createState();
    const publicCardId = state.players.player2.hand.shift();
    if (!publicCardId) throw new Error("测试起手为空");
    state.players.player2.discardPile.push(publicCardId);

    const view = createPlayerGameView(state, "player1");
    expect(view.players.player2.discardPile).toContain(publicCardId);
    expect(view.cardInstances[publicCardId]).toEqual(state.cardInstances[publicCardId]);
  });

  it("不会修改服务端权威状态", () => {
    const state = createState();
    const snapshot = structuredClone(state);
    createPlayerGameView(state, "player1");
    expect(state).toEqual(snapshot);
  });

  it("隐藏对手检索牌库时看到的具体卡牌", () => {
    const state = createState();
    const revealed = state.players.player2.drawPile.splice(0, 4);
    state.pendingTacticalSupport = {
      kind: "deck_search_choice",
      controllerId: "player2",
      sourceInstanceId: state.players.player2.hand[0],
      effectId: "RM-E013",
      revealedInstanceIds: revealed,
      maximumOperatorCost: 3,
    };

    const view = createPlayerGameView(state, "player1");
    const pending = view.pendingTacticalSupport;
    expect(pending?.kind).toBe("deck_search_choice");
    if (pending?.kind !== "deck_search_choice") return;
    expect(pending.revealedInstanceIds).toHaveLength(4);
    expect(pending.revealedInstanceIds.every((id) => id.startsWith("hidden:player2:revealed:"))).toBe(true);
    expect(revealed.some((id) => view.cardInstances[id])).toBe(false);
  });
});
