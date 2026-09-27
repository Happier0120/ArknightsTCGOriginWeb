import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { applyGameCommand, createGame } from "./engine";
import { executeEffectInstructions, type EffectInstruction } from "./effects";
import { getCurrentOperatorStats } from "./operators";
import type { GameState, PlayerId } from "./schema";

const config = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-5-1-test",
};

function createEffectState() {
  const state = createGame(gameContent, config);
  state.status = "playing";
  state.phase = "main";
  state.turnNumber = 3;
  state.activePlayer = "player1";
  state.currentViewer = "player1";
  state.handoff = null;
  return state;
}

function putOperatorOnBoard(
  state: GameState,
  playerId: PlayerId,
  name: string,
  slotIndex: number,
  options: { currentLife?: number; isUpright?: boolean } = {},
) {
  const player = state.players[playerId];
  const instanceId = [...player.hand, ...player.drawPile].find((candidateId) => {
    const definitionId = state.cardInstances[candidateId]?.definitionId;
    return gameContent.cards.find((card) => card.id === definitionId)?.name === name;
  });
  if (!instanceId) throw new Error(`找不到干员「${name}」`);
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  const definitionId = state.cardInstances[instanceId].definitionId;
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error(`「${name}」不是干员`);
  player.deploymentSlots[slotIndex] = {
    instanceId,
    currentLife: options.currentLife ?? card.life,
    isUpright: options.isUpright ?? true,
    deployedTurn: 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return { instanceId, card };
}

function effect(state: GameState, instructions: EffectInstruction[]) {
  const result = executeEffectInstructions(state, instructions, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function command(state: GameState, input: Parameters<typeof applyGameCommand>[1]) {
  const result = applyGameCommand(state, input, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("模块5.1基础效果执行器", () => {
  it("按照指令顺序抽牌、恢复DP并提高DP上限，且不修改输入状态", () => {
    const state = createEffectState();
    state.players.player1.maxDp = 5;
    state.players.player1.availableDp = 1;
    const original = structuredClone(state);

    const result = effect(state, [
      { type: "draw_cards", playerId: "player1", amount: 2 },
      { type: "recover_dp", playerId: "player1", amount: 10 },
      { type: "increase_max_dp", playerId: "player1", amount: 2 },
    ]);

    expect(state).toEqual(original);
    expect(result.state.players.player1.hand).toHaveLength(7);
    expect(result.state.players.player1.maxDp).toBe(7);
    expect(result.state.players.player1.availableDp).toBe(7);
    expect(result.steps.map((step) => step.actualAmount)).toEqual([2, 4, 2]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "effect_cards_drawn",
      "effect_dp_recovered",
      "effect_max_dp_increased",
    ]);
  });

  it("多张抽牌逐张处理，牌库中途抽空时立即判负并停止后续效果", () => {
    const state = createEffectState();
    state.players.player1.drawPile = state.players.player1.drawPile.slice(0, 1);
    state.players.player1.maxDp = 5;
    state.players.player1.availableDp = 0;

    const result = effect(state, [
      { type: "draw_cards", playerId: "player1", amount: 2 },
      { type: "recover_dp", playerId: "player1", amount: 5 },
    ]);

    expect(result.state.status).toBe("finished");
    expect(result.state.winner).toBe("player2");
    expect(result.state.finishReason).toBe("deck_out");
    expect(result.state.players.player1.availableDp).toBe(0);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].actualAmount).toBe(1);
  });

  it("回复生命不超过卡面上限，失去全部生命时按卡面CD进入候场区", () => {
    const state = createEffectState();
    const { instanceId, card } = putOperatorOnBoard(
      state,
      "player1",
      "米格鲁",
      2,
      { currentLife: 1 },
    );

    const healed = effect(state, [
      { type: "heal_operator", playerId: "player1", slotIndex: 2, amount: 10 },
    ]);
    expect(healed.state.players.player1.deploymentSlots[2]?.currentLife).toBe(
      card.life,
    );
    expect(healed.steps[0].actualAmount).toBe(card.life - 1);

    const defeated = effect(healed.state, [
      {
        type: "damage_operator",
        playerId: "player1",
        slotIndex: 2,
        amount: card.life,
      },
    ]);
    expect(defeated.state.players.player1.deploymentSlots[2]).toBeNull();
    expect(defeated.state.players.player1.redeployZone).toContainEqual({
      instanceId,
      remainingCd: card.redeployCd,
      source: "defeat",
    });
  });

  it("无法执行的单项效果被跳过，后续效果继续结算", () => {
    const state = createEffectState();
    state.players.player1.maxDp = 4;
    state.players.player1.availableDp = 1;

    const result = effect(state, [
      { type: "heal_operator", playerId: "player1", slotIndex: 6, amount: 1 },
      { type: "recover_dp", playerId: "player1", amount: 2 },
    ]);

    expect(result.steps[0]).toMatchObject({ applied: false });
    expect(result.steps[0].reason).toMatch(/没有有效干员/);
    expect(result.steps[1]).toMatchObject({ applied: true, actualAmount: 2 });
    expect(result.state.players.player1.availableDp).toBe(3);
  });

  it("ATK和DEF修正参与后续真实战斗结算", () => {
    let state = createEffectState();
    putOperatorOnBoard(state, "player1", "芬", 0);
    const defender = putOperatorOnBoard(
      state,
      "player2",
      "整合运动轻甲卫兵",
      1,
      { isUpright: false },
    );
    const beforeLife = defender.card.life;

    const modified = effect(state, [
      {
        type: "modify_operator_stats",
        playerId: "player1",
        slotIndex: 0,
        atkDelta: 3,
        defDelta: 0,
      },
      {
        type: "modify_operator_stats",
        playerId: "player2",
        slotIndex: 1,
        atkDelta: 0,
        defDelta: -1,
      },
    ]);
    state = modified.state;
    expect(getCurrentOperatorStats(gameContent, state, "player1", 0)?.atk).toBe(5);
    expect(getCurrentOperatorStats(gameContent, state, "player2", 1)?.def).toBe(
      defender.card.def - 1,
    );

    state = command(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "operator", slotIndex: 1 },
    });
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = command(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });
    expect(state.players.player2.deploymentSlots[1]?.currentLife).toBe(
      beforeLife - 1,
    );
  });

  it("效果移除最后一个理智盾时立即结束对局", () => {
    const state = createEffectState();
    state.players.player2.shields = 2;

    const result = effect(state, [
      { type: "lose_shields", playerId: "player2", amount: 3 },
      { type: "draw_cards", playerId: "player1", amount: 1 },
    ]);

    expect(result.state.players.player2.shields).toBe(0);
    expect(result.state.status).toBe("finished");
    expect(result.state.winner).toBe("player1");
    expect(result.state.finishReason).toBe("shields_depleted");
    expect(result.steps).toHaveLength(1);
  });

  it("在执行前拒绝结构非法的效果批次", () => {
    const state = createEffectState();
    const invalid = [
      { type: "draw_cards", playerId: "player1", amount: 0 },
    ] as unknown as EffectInstruction[];
    const result = executeEffectInstructions(state, invalid, gameContent);

    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });
});
