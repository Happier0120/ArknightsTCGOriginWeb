import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { applyGameCommand, createGame, getLegalInterceptors } from "./engine";
import type { GameState, PlayerId } from "./schema";
import { enqueueTriggerEvent } from "./triggers";

const config = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-5-3-test",
};

function createResolutionState(activePlayer: PlayerId = "player1") {
  const state = createGame(gameContent, config);
  state.status = "playing";
  state.phase = "main";
  state.turnNumber = 5;
  state.activePlayer = activePlayer;
  state.currentViewer = activePlayer;
  state.handoff = null;
  state.turnFacts.turnNumber = 5;
  state.players[activePlayer].maxDp = 10;
  state.players[activePlayer].availableDp = 10;
  return state;
}

function findInstance(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
) {
  const instanceId = Object.values(state.cardInstances).find(
    (instance) =>
      instance.owner === playerId && instance.definitionId === definitionId,
  )?.id;
  if (!instanceId) throw new Error(`找不到实例 ${playerId}/${definitionId}`);
  return instanceId;
}

function putInHand(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
) {
  const instanceId = findInstance(state, playerId, definitionId);
  const player = state.players[playerId];
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  if (!player.hand.includes(instanceId)) player.hand.push(instanceId);
  return instanceId;
}

function putOnBoard(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
  slotIndex: number,
  options: { currentLife?: number; isUpright?: boolean } = {},
) {
  const instanceId = findInstance(state, playerId, definitionId);
  const player = state.players[playerId];
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("测试卡不是干员");
  player.deploymentSlots[slotIndex] = {
    instanceId,
    currentLife: options.currentLife ?? card.life,
    isUpright: options.isUpright ?? true,
    deployedTurn: 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return instanceId;
}

function command(
  state: GameState,
  input: Parameters<typeof applyGameCommand>[1],
) {
  const result = applyGameCommand(state, input, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe("模块5.3触发选择与逐项结算", () => {
  it("结算芬的必发能力，并把【拦截】赋予本回合下一名合格干员", () => {
    let state = createResolutionState();
    const fenId = findInstance(state, "player1", "RI-O001");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_retreated",
      subjectPlayerId: "player1",
      subjectInstanceId: fenId,
      subjectDefinitionId: "RI-O001",
      subjectSlotIndex: 0,
    });

    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player1",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
    });
    expect(state.triggerQueue).toHaveLength(0);
    expect(state.ongoingEffects[0]).toMatchObject({
      kind: "next_deployment",
      payload: "grant_intercept",
    });

    const migruId = putInHand(state, "player1", "RI-O002");
    state = command(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: migruId,
      slotIndex: 2,
    });
    expect(state.ongoingEffects).toEqual([
      expect.objectContaining({
        kind: "granted_keyword",
        targetInstanceId: migruId,
        keyword: "intercept",
      }),
    ]);

    state.status = "defending";
    state.currentViewer = "player1";
    state.pendingAttack = {
      attackerPlayerId: "player2",
      attackerSlotIndex: 0,
      defenderPlayerId: "player1",
      target: { kind: "operator", slotIndex: 1 },
    };
    expect(getLegalInterceptors(state, gameContent)).toContain(2);
  });

  it("可选能力可以不发动，队列清空后恢复进入队列前的查看玩家", () => {
    const state = createResolutionState();
    const soldierId = findInstance(state, "player2", "RM-O001");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_defeated",
      subjectPlayerId: "player2",
      subjectInstanceId: soldierId,
      subjectDefinitionId: "RM-O001",
      subjectSlotIndex: 1,
    });
    expect(state.currentViewer).toBe("player1");

    let next = command(state, {
      type: "CONFIRM_TRIGGER_HANDOFF",
      playerId: "player2",
    });
    expect(next.currentViewer).toBe("player2");
    next = command(next, {
      type: "RESOLVE_TRIGGER",
      playerId: "player2",
      triggerId: next.triggerQueue[0].id,
      action: "skip",
    });
    expect(next.triggerQueue).toHaveLength(0);
    expect(next.currentViewer).toBe("player1");
    expect(next.log.at(-1)?.kind).toBe("trigger_skipped");
  });

  it("部署触发在结算时选择合法目标并造成伤害", () => {
    let state = createResolutionState();
    const blazeId = findInstance(state, "player1", "RI-O005");
    putOnBoard(state, "player2", "RM-O001", 3, { isUpright: false });
    state.turnFacts.player1.retreatedOperatorIds.push(
      findInstance(state, "player1", "RI-O001"),
    );
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_deployed",
      subjectPlayerId: "player1",
      subjectInstanceId: blazeId,
      subjectDefinitionId: "RI-O005",
      subjectSlotIndex: 0,
    });

    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player1",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      target: { kind: "operator", playerId: "player2", slotIndex: 3 },
    });
    expect(state.players.player2.deploymentSlots[3]?.currentLife).toBe(1);
    expect(state.triggerQueue).toHaveLength(0);
  });

  it("结算中的击溃会在当前能力完成后创建新的触发批次", () => {
    let state = createResolutionState("player2");
    const crusherId = putOnBoard(state, "player2", "RM-O006", 0);
    putOnBoard(state, "player2", "RM-O001", 1, { currentLife: 1 });
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_deployed",
      subjectPlayerId: "player2",
      subjectInstanceId: crusherId,
      subjectDefinitionId: "RM-O006",
      subjectSlotIndex: 0,
    });
    const originalBatch = state.triggerQueue[0].batchId;

    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player2",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      target: { kind: "operator", playerId: "player2", slotIndex: 1 },
    });

    expect(state.players.player2.deploymentSlots[1]).toBeNull();
    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RM-E008",
      "RM-E002",
    ]);
    expect(state.triggerQueue[0].batchId).toBeGreaterThan(originalBatch);
  });

  it("碎骨在己方整合运动干员本回合被击溃后使敌方地面干员DEF降低2", () => {
    let state = createResolutionState("player2");
    const skullshattererId = putOnBoard(state, "player2", "RM-O005", 0);
    const defeatedId = findInstance(state, "player2", "RM-O001");
    state.turnFacts.player2.defeatedOperatorIds.push(defeatedId);
    putOnBoard(state, "player1", "RI-O001", 1);
    putOnBoard(state, "player1", "RI-O006", 2);
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_deployed",
      subjectPlayerId: "player2",
      subjectInstanceId: skullshattererId,
      subjectDefinitionId: "RM-O005",
      subjectSlotIndex: 0,
    });

    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RM-E006",
    ]);
    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player2",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      target: { kind: "operator", playerId: "player1", slotIndex: 1 },
    });
    expect(state.ongoingEffects).toContainEqual(
      expect.objectContaining({
        kind: "stat_modifier",
        effectId: "RM-E006",
        defDelta: -2,
      }),
    );
  });

  it("先抽后弃的能力分成两个步骤，且只能弃置结算后的当前手牌", () => {
    let state = createResolutionState("player2");
    const soldierId = findInstance(state, "player2", "RM-O001");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_defeated",
      subjectPlayerId: "player2",
      subjectInstanceId: soldierId,
      subjectDefinitionId: "RM-O001",
      subjectSlotIndex: 1,
    });
    const handBefore = state.players.player2.hand.length;

    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player2",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
    });
    expect(state.players.player2.hand).toHaveLength(handBefore + 1);
    expect(state.triggerQueue[0].stage).toBe("discard_after_draw");

    const discardId = state.players.player2.hand[0];
    state = command(state, {
      type: "RESOLVE_TRIGGER",
      playerId: "player2",
      triggerId: state.triggerQueue[0].id,
      action: "activate",
      discardInstanceId: discardId,
    });
    expect(state.players.player2.hand).toHaveLength(handBefore);
    expect(state.players.player2.discardPile).toContain(discardId);
    expect(state.triggerQueue).toHaveLength(0);
  });
});
