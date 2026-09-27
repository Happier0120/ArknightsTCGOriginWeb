import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { applyGameCommand, createGame } from "./engine";
import type { GameCommand, GameState, PlayerId } from "./schema";

const baseConfig = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-6-4-field-test",
};

function run(state: GameState, command: GameCommand) {
  const result = applyGameCommand(state, command, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function mainState() {
  const state = createGame(gameContent, baseConfig);
  state.status = "playing";
  state.phase = "main";
  state.turnNumber = 3;
  state.activePlayer = "player1";
  state.currentViewer = "player1";
  state.players.player1.maxDp = 10;
  state.players.player1.availableDp = 10;
  state.players.player2.maxDp = 10;
  state.players.player2.availableDp = 10;
  return state;
}

function moveDefinitionToHand(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
) {
  const player = state.players[playerId];
  const instanceId = Object.values(state.cardInstances).find(
    (instance) =>
      instance.owner === playerId && instance.definitionId === definitionId,
  )?.id;
  if (!instanceId) throw new Error(`找不到卡牌 ${definitionId}`);
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  player.discardPile = player.discardPile.filter((id) => id !== instanceId);
  player.hand.push(instanceId);
  return instanceId;
}

function takeOperator(
  state: GameState,
  playerId: PlayerId,
  name: string,
) {
  const player = state.players[playerId];
  const instanceId = [...player.hand, ...player.drawPile].find((candidateId) => {
    const definitionId = state.cardInstances[candidateId]?.definitionId;
    const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
    return card?.type === "operator" && card.name === name;
  });
  if (!instanceId) throw new Error(`找不到干员「${name}」`);
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  const card = gameContent.cards.find(
    (candidate) => candidate.id === state.cardInstances[instanceId].definitionId,
  );
  if (!card || card.type !== "operator") throw new Error("干员定义无效");
  return { instanceId, card };
}

function deploy(
  state: GameState,
  playerId: PlayerId,
  name: string,
  slotIndex: number,
  currentLife?: number,
) {
  const selected = takeOperator(state, playerId, name);
  state.players[playerId].deploymentSlots[slotIndex] = {
    instanceId: selected.instanceId,
    currentLife: currentLife ?? selected.card.life,
    isUpright: true,
    deployedTurn: state.turnNumber - 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return selected;
}

describe("模块6.4 共享场地", () => {
  it("默认验收种子让双方起手都包含场地卡", () => {
    const state = createGame(gameContent, {
      ...baseConfig,
      seed: "module-6-4-69",
    });
    for (const playerId of ["player1", "player2"] as const) {
      expect(
        state.players[playerId].hand.some((instanceId) => {
          const definitionId = state.cardInstances[instanceId].definitionId;
          return gameContent.cards.find((card) => card.id === definitionId)?.type ===
            "field";
        }),
      ).toBe(true);
    }
  });

  it("支付费用使用场地，并由对手的新场地替换到原拥有者废弃区", () => {
    let state = mainState();
    const rhodesField = moveDefinitionToHand(state, "player1", "RI-F001");
    state = run(state, {
      type: "PLAY_FIELD",
      playerId: "player1",
      cardInstanceId: rhodesField,
    });
    expect(state.sharedField).toEqual({
      instanceId: rhodesField,
      controllerId: "player1",
    });
    expect(state.players.player1.availableDp).toBe(8);
    expect(state.players.player1.hand).not.toContain(rhodesField);

    const reunionField = moveDefinitionToHand(state, "player2", "RM-F001");
    state.activePlayer = "player2";
    state.currentViewer = "player2";
    state = run(state, {
      type: "PLAY_FIELD",
      playerId: "player2",
      cardInstanceId: reunionField,
    });
    expect(state.sharedField).toEqual({
      instanceId: reunionField,
      controllerId: "player2",
    });
    expect(state.players.player1.discardPile).toContain(rhodesField);
    expect(state.players.player2.discardPile).not.toContain(rhodesField);
  });

  it("救护站只在受伤干员主动撤退后治疗留守干员，且每张实体每回合一次", () => {
    let state = mainState();
    const fieldId = moveDefinitionToHand(state, "player1", "RI-F001");
    state = run(state, {
      type: "PLAY_FIELD",
      playerId: "player1",
      cardInstanceId: fieldId,
    });
    deploy(state, "player1", "芬", 0, 1);
    deploy(state, "player1", "芙蓉", 1, 1);
    state = run(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    });
    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RI-E002",
      "RI-E018",
    ]);

    state = run(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player1",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
    });
    state = run(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player1",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      target: { kind: "operator", playerId: "player1", slotIndex: 1 },
    });
    expect(state.players.player1.deploymentSlots[1]?.currentLife).toBe(2);
    expect(state.effectUsages).toContainEqual({
      controllerId: "player1",
      effectId: "RI-E018",
      sourceInstanceId: fieldId,
      turnNumber: 3,
      count: 1,
    });

    deploy(state, "player1", "米格鲁", 0, 2);
    state = run(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    });
    expect(state.triggerQueue.some((trigger) => trigger.effectId === "RI-E018")).toBe(false);
  });

  it("救护站不响应满生命干员撤退，也不在对手回合响应", () => {
    let state = mainState();
    const fieldId = moveDefinitionToHand(state, "player1", "RI-F001");
    state = run(state, {
      type: "PLAY_FIELD",
      playerId: "player1",
      cardInstanceId: fieldId,
    });
    deploy(state, "player1", "米格鲁", 0);
    state = run(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    });
    expect(state.triggerQueue).toHaveLength(0);
  });

  it("整合运动营地在己方干员被击溃后加速另一张候场卡", () => {
    let state = mainState();
    state.players.player1.deckId = "RM-MVP";
    state.players.player1.commanderId = "RM-C001";
    const fieldId = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player2" && instance.definitionId === "RM-F001",
    )?.id;
    if (!fieldId) throw new Error("找不到整合运动场地");
    state.cardInstances[fieldId].owner = "player1";
    state.players.player2.hand = state.players.player2.hand.filter((id) => id !== fieldId);
    state.players.player2.drawPile = state.players.player2.drawPile.filter((id) => id !== fieldId);
    state.players.player1.hand.push(fieldId);
    state = run(state, {
      type: "PLAY_FIELD",
      playerId: "player1",
      cardInstanceId: fieldId,
    });

    const victimSource = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player2" && instance.definitionId === "RM-O007",
    );
    const targetSource = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player2" && instance.definitionId === "RM-O002",
    );
    if (!victimSource || !targetSource) throw new Error("找不到整合运动测试干员");
    for (const source of [victimSource, targetSource]) {
      state.cardInstances[source.id].owner = "player1";
      state.players.player2.hand = state.players.player2.hand.filter((id) => id !== source.id);
      state.players.player2.drawPile = state.players.player2.drawPile.filter((id) => id !== source.id);
    }
    state.players.player1.redeployZone.push({
      instanceId: targetSource.id,
      remainingCd: 2,
      source: "defeat",
    });
    const victimCard = gameContent.cards.find((card) => card.id === "RM-O007");
    if (!victimCard || victimCard.type !== "operator") throw new Error("测试干员无效");
    state.players.player1.deploymentSlots[0] = {
      instanceId: victimSource.id,
      currentLife: victimCard.life,
      isUpright: true,
      deployedTurn: 2,
      atkModifier: 0,
      defModifier: 0,
    };
    const supportSource = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player2" && instance.definitionId === "RM-S002",
    );
    if (!supportSource) throw new Error("找不到战地搜集");
    state.cardInstances[supportSource.id].owner = "player1";
    state.players.player2.hand = state.players.player2.hand.filter((id) => id !== supportSource.id);
    state.players.player2.drawPile = state.players.player2.drawPile.filter((id) => id !== supportSource.id);
    state.players.player1.hand.push(supportSource.id);

    state = run(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportSource.id,
      target: { kind: "sacrifice", slotIndex: 0 },
    });
    expect(state.triggerQueue.some((trigger) => trigger.effectId === "RM-E017")).toBe(true);
    const fieldTrigger = state.triggerQueue.find((trigger) => trigger.effectId === "RM-E017")!;
    while (state.triggerQueue[0]?.id !== fieldTrigger.id) {
      const current = state.triggerQueue[0];
      state = run(state, {
        type: "RESOLVE_TRIGGER",
        playerId: current.controllerId,
        triggerId: current.id,
        action: current.optional ? "skip" : "activate",
      });
    }
    state = run(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player1",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      target: {
        kind: "redeploy",
        playerId: "player1",
        instanceId: targetSource.id,
      },
    });
    expect(state.players.player1.redeployZone).toContainEqual({
      instanceId: targetSource.id,
      remainingCd: 1,
      source: "defeat",
    });
  });
});
