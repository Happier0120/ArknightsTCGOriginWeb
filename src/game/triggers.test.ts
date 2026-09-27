import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { applyGameCommand, createGame } from "./engine";
import { executeEffectInstructions } from "./effects";
import type { GameState, PlayerId } from "./schema";
import { enqueueTriggerEvent } from "./triggers";

const config = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-5-2-test",
};

function createTriggerState() {
  const state = createGame(gameContent, config);
  state.status = "playing";
  state.phase = "main";
  state.turnNumber = 4;
  state.activePlayer = "player1";
  state.currentViewer = "player1";
  state.turnFacts.turnNumber = 4;
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

function putOnBoard(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
  slotIndex: number,
) {
  const instanceId = findInstance(state, playerId, definitionId);
  const player = state.players[playerId];
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("测试卡不是干员");
  player.deploymentSlots[slotIndex] = {
    instanceId,
    currentLife: card.life,
    isUpright: true,
    deployedTurn: 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return instanceId;
}

describe("模块5.2触发事件与确定性队列", () => {
  it("现有撤退指令会真实创建队列，并在队列结算前暂停其他指令", () => {
    const state = createTriggerState();
    putOnBoard(state, "player1", "RI-O001", 0);
    state.players.player1.maxDp = 4;

    const retreated = applyGameCommand(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    }, gameContent);
    expect(retreated.ok).toBe(true);
    if (!retreated.ok) return;
    expect(retreated.state.triggerQueue[0]?.effectId).toBe("RI-E002");
    expect(retreated.state.players.player1.deploymentSlots[0]).toBeNull();

    const blocked = applyGameCommand(retreated.state, {
      type: "ADVANCE_PHASE",
      playerId: "player1",
    }, gameContent);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/先结算/);
  });

  it("主动撤退后保存离场来源快照，并将同批能力按稳定顺序入队", () => {
    const state = createTriggerState();
    const fenId = findInstance(state, "player1", "RI-O001");
    putOnBoard(state, "player1", "RI-O004", 1);

    const events = enqueueTriggerEvent(state, gameContent, {
      kind: "operator_retreated",
      subjectPlayerId: "player1",
      subjectInstanceId: fenId,
      subjectDefinitionId: "RI-O001",
      subjectSlotIndex: 0,
    });

    expect(events).toHaveLength(1);
    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RI-E002",
      "RI-E004",
    ]);
    expect(state.triggerQueue[0]).toMatchObject({
      sourceInstanceId: fenId,
      sourceSlotIndex: 0,
      optional: false,
    });
    expect(state.triggerQueue[1].optional).toBe(true);
    expect(state.turnFacts.player1.retreatedOperatorIds).toEqual([fenId]);
  });

  it("双方能力同时触发时，当前回合玩家的能力排在非当前回合玩家之前", () => {
    const state = createTriggerState();
    const blazeId = putOnBoard(state, "player1", "RI-O005", 0);
    putOnBoard(state, "player2", "RM-O006", 1);
    const soldierId = findInstance(state, "player2", "RM-O001");

    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_defeated",
      subjectPlayerId: "player2",
      subjectInstanceId: soldierId,
      subjectDefinitionId: "RM-O001",
      subjectSlotIndex: 2,
      causePlayerId: "player1",
      causeInstanceId: blazeId,
      wasInterceptor: true,
    });

    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RI-E006",
      "RM-E008",
      "RM-E002",
    ]);
    expect(state.triggerQueue.map((trigger) => trigger.priority)).toEqual([
      "active_player",
      "non_active_player",
      "non_active_player",
    ]);
    expect(new Set(state.triggerQueue.map((trigger) => trigger.batchId)).size).toBe(1);
  });

  it("仅在本回合事实成立后收集带前置条件的部署触发", () => {
    const state = createTriggerState();
    const blazeId = findInstance(state, "player1", "RI-O005");

    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_deployed",
      subjectPlayerId: "player1",
      subjectInstanceId: blazeId,
      subjectDefinitionId: "RI-O005",
      subjectSlotIndex: 3,
    });
    expect(state.triggerQueue).toHaveLength(0);

    const migruId = findInstance(state, "player1", "RI-O002");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_retreated",
      subjectPlayerId: "player1",
      subjectInstanceId: migruId,
      subjectDefinitionId: "RI-O002",
      subjectSlotIndex: 1,
    });
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_deployed",
      subjectPlayerId: "player1",
      subjectInstanceId: blazeId,
      subjectDefinitionId: "RI-O005",
      subjectSlotIndex: 3,
    });

    expect(state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RI-E005",
    ]);
  });

  it("基础效果击溃干员后也会收集自身与友方触发", () => {
    const state = createTriggerState();
    putOnBoard(state, "player2", "RM-O006", 0);
    putOnBoard(state, "player2", "RM-O001", 1);
    state.players.player2.deploymentSlots[1]!.currentLife = 1;

    const result = executeEffectInstructions(state, [{
      type: "damage_operator",
      playerId: "player2",
      slotIndex: 1,
      amount: 1,
    }], gameContent);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.triggerQueue.map((trigger) => trigger.effectId)).toEqual([
      "RM-E008",
      "RM-E002",
    ]);
    expect(result.events.at(-1)?.kind).toBe("triggers_queued");
  });
});
