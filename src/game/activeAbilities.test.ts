import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { applyGameCommand, createGame } from "./engine";
import { getActiveAbilityOptions } from "./activeAbilities";
import { getCurrentOperatorStats } from "./operators";
import type { GameCommand, GameState, PlayerId } from "./schema";

const config = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-6-3-test",
};

function run(state: GameState, command: GameCommand) {
  const result = applyGameCommand(state, command, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function finishMulligans(state: GameState) {
  let next = run(state, {
    type: "SUBMIT_MULLIGAN",
    playerId: "player1",
    cardInstanceIds: [],
  });
  next = run(next, { type: "CONFIRM_HANDOFF", playerId: "player2" });
  next = run(next, {
    type: "SUBMIT_MULLIGAN",
    playerId: "player2",
    cardInstanceIds: [],
  });
  return run(next, {
    type: "CONFIRM_HANDOFF",
    playerId: next.handoff!.nextPlayer,
  });
}

function createMainState(
  player1DeckId = "RI-MVP",
  player2DeckId = "RM-MVP",
) {
  let state = finishMulligans(createGame(gameContent, {
    ...config,
    player1DeckId,
    player2DeckId,
  }));
  state = run(state, { type: "ADVANCE_PHASE", playerId: "player1" });
  state = run(state, { type: "ADVANCE_PHASE", playerId: "player1" });
  state.turnNumber = 3;
  state.players.player1.maxDp = 10;
  state.players.player1.availableDp = 10;
  return state;
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
  const definitionId = state.cardInstances[instanceId].definitionId;
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("干员定义无效");
  return { instanceId, card };
}

function deployForTest(
  state: GameState,
  playerId: PlayerId,
  name: string,
  slotIndex: number,
  options: { currentLife?: number; isUpright?: boolean; deployedTurn?: number } = {},
) {
  const selected = takeOperator(state, playerId, name);
  state.players[playerId].deploymentSlots[slotIndex] = {
    instanceId: selected.instanceId,
    currentLife: options.currentLife ?? selected.card.life,
    isUpright: options.isUpright ?? true,
    deployedTurn: options.deployedTurn ?? state.turnNumber - 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return selected;
}

function sendToRedeploy(
  state: GameState,
  playerId: PlayerId,
  name: string,
  remainingCd: number,
) {
  const selected = takeOperator(state, playerId, name);
  state.players[playerId].redeployZone.push({
    instanceId: selected.instanceId,
    remainingCd,
    source: "defeat",
  });
  return selected;
}

describe("模块6.3 主动能力与指挥官指令", () => {
  it("阿米娅指挥官可令横置干员撤退，并在准备阶段恢复竖置", () => {
    const state = createMainState();
    const fen = deployForTest(state, "player1", "芬", 0, { isUpright: false });

    const result = applyGameCommand(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "commander" },
      target: { kind: "retreat", slotIndex: 0 },
    }, gameContent);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.players.player1.commanderIsUpright).toBe(true);
    expect(result.state.players.player1.commanderIsUpright).toBe(false);
    expect(result.state.players.player1.deploymentSlots[0]).toBeNull();
    expect(result.state.players.player1.redeployZone).toContainEqual({
      instanceId: fen.instanceId,
      remainingCd: 1,
      source: "retreat",
    });
    expect(getActiveAbilityOptions(
      result.state,
      gameContent,
      "player1",
      { kind: "commander" },
    ).kind).toBe("unavailable");

    const readyState = structuredClone(result.state);
    readyState.triggerQueue = [];
    readyState.status = "playing";
    readyState.phase = "ready";
    const afterReady = run(readyState, {
      type: "ADVANCE_PHASE",
      playerId: "player1",
    });
    expect(afterReady.players.player1.commanderIsUpright).toBe(true);
  });

  it("塔露拉指令支付附加费用，并令目标本回合攻击造成额外伤害", () => {
    let state = createMainState("RM-MVP", "RI-MVP");
    deployForTest(state, "player1", "整合运动弩手", 0);
    const hound = deployForTest(state, "player1", "猎狗", 1);
    deployForTest(state, "player2", "芬", 0, { isUpright: false });

    state = run(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "commander" },
      target: {
        kind: "sacrifice_and_operator",
        sacrificeSlotIndex: 0,
        targetPlayerId: "player1",
        targetSlotIndex: 1,
      },
    });
    expect(state.players.player1.deploymentSlots[0]).toBeNull();
    expect(state.players.player1.commanderIsUpright).toBe(false);
    expect(getCurrentOperatorStats(gameContent, state, "player1", 1)?.atk).toBe(4);

    state = run(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 1,
      target: { kind: "operator", slotIndex: 0 },
    });
    state = run(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = run(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });
    expect(state.players.player2.deploymentSlots[0]).toBeNull();
    expect(state.players.player2.redeployZone).toHaveLength(1);
    expect(state.players.player1.deploymentSlots[1]?.instanceId).toBe(hound.instanceId);
  });

  it("芙蓉、阿米娅的技能会横置来源并结算治疗或伤害", () => {
    let healState = createMainState();
    deployForTest(healState, "player1", "芙蓉", 0);
    deployForTest(healState, "player1", "芬", 1, { currentLife: 1 });
    healState = run(healState, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: { kind: "operator", playerId: "player1", slotIndex: 1 },
    });
    expect(healState.players.player1.deploymentSlots[0]?.isUpright).toBe(false);
    expect(healState.players.player1.deploymentSlots[1]?.currentLife).toBe(2);

    let damageState = createMainState();
    deployForTest(damageState, "player1", "阿米娅", 0);
    deployForTest(damageState, "player2", "猎狗", 0);
    damageState = run(damageState, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: { kind: "operator", playerId: "player2", slotIndex: 0 },
    });
    expect(damageState.players.player1.availableDp).toBe(8);
    expect(damageState.players.player2.deploymentSlots[0]).toBeNull();
  });

  it("安赛尔与梅菲斯特分别缩短一名或至多两名候场干员的CD", () => {
    let rhodesState = createMainState();
    deployForTest(rhodesState, "player1", "安赛尔", 0);
    const fen = sendToRedeploy(rhodesState, "player1", "芬", 1);
    rhodesState = run(rhodesState, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: { kind: "redeploy", instanceIds: [fen.instanceId] },
    });
    expect(rhodesState.players.player1.hand).toContain(fen.instanceId);

    let reunionState = createMainState("RM-MVP", "RI-MVP");
    deployForTest(reunionState, "player1", "梅菲斯特", 0);
    const soldier = sendToRedeploy(reunionState, "player1", "整合运动士兵", 1);
    const hound = sendToRedeploy(reunionState, "player1", "猎狗", 2);
    reunionState = run(reunionState, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: {
        kind: "redeploy",
        instanceIds: [soldier.instanceId, hound.instanceId],
      },
    });
    expect(reunionState.players.player1.hand).toContain(soldier.instanceId);
    expect(reunionState.players.player1.redeployZone).toContainEqual({
      instanceId: hound.instanceId,
      remainingCd: 1,
      source: "defeat",
    });
  });

  it("凯尔希支付1 DP后从手牌免费部署低费罗德岛干员", () => {
    let state = createMainState();
    deployForTest(state, "player1", "凯尔希", 0);
    const fen = takeOperator(state, "player1", "芬");
    state.players.player1.hand.push(fen.instanceId);

    state = run(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: { kind: "free_deploy", instanceId: fen.instanceId, slotIndex: 1 },
    });
    expect(state.players.player1.availableDp).toBe(9);
    expect(state.players.player1.deploymentSlots[1]?.instanceId).toBe(fen.instanceId);
    expect(state.players.player1.deploymentSlots[1]?.deployedTurn).toBe(3);
    expect(state.players.player1.hand).not.toContain(fen.instanceId);
  });

  it("整合运动术师支付击溃费用造成伤害，并拒绝本回合部署者发动技能", () => {
    let state = createMainState("RM-MVP", "RI-MVP");
    deployForTest(state, "player1", "整合运动术师", 0);
    deployForTest(state, "player1", "整合运动弩手", 1);
    deployForTest(state, "player2", "芬", 0);
    state = run(state, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: {
        kind: "sacrifice_and_operator",
        sacrificeSlotIndex: 1,
        targetPlayerId: "player2",
        targetSlotIndex: 0,
      },
    });
    expect(state.players.player1.deploymentSlots[1]).toBeNull();
    expect(state.players.player2.deploymentSlots[0]?.currentLife).toBe(1);

    const fresh = createMainState();
    deployForTest(fresh, "player1", "芙蓉", 0, { deployedTurn: fresh.turnNumber });
    deployForTest(fresh, "player1", "芬", 1, { currentLife: 1 });
    const rejected = applyGameCommand(fresh, {
      type: "ACTIVATE_ABILITY",
      playerId: "player1",
      source: { kind: "operator", slotIndex: 0 },
      target: { kind: "operator", playerId: "player1", slotIndex: 1 },
    }, gameContent);
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(fresh);
  });

  it("浮士德攻击横置干员时应用临时ATK加成", () => {
    let state = createMainState("RM-MVP", "RI-MVP");
    deployForTest(state, "player1", "浮士德", 0);
    deployForTest(state, "player2", "米格鲁", 0, { isUpright: false });
    state = run(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "operator", slotIndex: 0 },
    });
    state = run(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = run(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });
    expect(state.log.some((entry) => entry.kind === "attack_stat_bonus")).toBe(true);
  });
});
