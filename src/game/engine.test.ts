import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import {
  applyGameCommand,
  createGame,
  getLegalAttackTargets,
  getLegalInterceptors,
} from "./engine";
import {
  GAME_SNAPSHOT_KEY,
  loadGameSnapshot,
  saveGameSnapshot,
  type StorageLike,
} from "./persistence";
import type { GameState, PlayerId } from "./schema";

const config = {
  player1DeckId: "RI-MVP",
  player2DeckId: "RM-MVP",
  firstPlayer: "player1" as const,
  seed: "module-2-test",
};

function command(state: GameState, input: Parameters<typeof applyGameCommand>[1]) {
  const result = applyGameCommand(state, input, gameContent);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function finishMulligans(state: GameState) {
  let next = command(state, {
    type: "SUBMIT_MULLIGAN",
    playerId: "player1",
    cardInstanceIds: [],
  });
  next = command(next, { type: "CONFIRM_HANDOFF", playerId: "player2" });
  next = command(next, {
    type: "SUBMIT_MULLIGAN",
    playerId: "player2",
    cardInstanceIds: [],
  });
  const nextPlayer = next.handoff?.nextPlayer;
  if (!nextPlayer) throw new Error("调度后缺少交接玩家");
  return command(next, { type: "CONFIRM_HANDOFF", playerId: nextPlayer });
}

function advance(state: GameState, playerId: PlayerId) {
  return command(state, { type: "ADVANCE_PHASE", playerId });
}

function reachMainPhase(state: GameState) {
  const playerId = state.activePlayer;
  let next = advance(state, playerId);
  next = advance(next, playerId);
  return next;
}

function putOperatorInHand(
  state: GameState,
  playerId: PlayerId,
  maximumCost = Number.POSITIVE_INFINITY,
  excludedIds: string[] = [],
) {
  const player = state.players[playerId];
  const allCards = [...player.hand, ...player.drawPile];
  const instanceId = allCards.find((candidateId) => {
    if (excludedIds.includes(candidateId)) return false;
    const definitionId = state.cardInstances[candidateId]?.definitionId;
    const card = gameContent.cards.find((item) => item.id === definitionId);
    return card?.type === "operator" && card.cost <= maximumCost;
  });
  if (!instanceId) throw new Error("找不到符合条件的干员");

  if (!player.hand.includes(instanceId)) {
    const drawIndex = player.drawPile.indexOf(instanceId);
    const displaced = player.hand[0];
    player.hand[0] = instanceId;
    player.drawPile[drawIndex] = displaced;
  }
  const definitionId = state.cardInstances[instanceId].definitionId;
  const card = gameContent.cards.find((item) => item.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("干员定义无效");
  return { instanceId, card };
}

function putOperatorOnBoard(
  state: GameState,
  playerId: PlayerId,
  name: string,
  slotIndex: number,
  options: { isUpright?: boolean; currentLife?: number; deployedTurn?: number } = {},
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
    deployedTurn: options.deployedTurn ?? Math.max(1, state.turnNumber - 1),
    atkModifier: 0,
    defModifier: 0,
  };
  return { instanceId, card };
}

function createCombatState() {
  const state = reachMainPhase(finishMulligans(createGame(gameContent, config)));
  state.turnNumber = 3;
  return state;
}

describe("确定性对局内核", () => {
  it("相同种子产生完全相同的初始牌序", () => {
    const first = createGame(gameContent, config);
    const second = createGame(gameContent, config);
    expect(first.players.player1.drawPile).toEqual(second.players.player1.drawPile);
    expect(first.players.player2.hand).toEqual(second.players.player2.hand);

    const different = createGame(gameContent, { ...config, seed: "another-seed" });
    expect(first.players.player1.drawPile).not.toEqual(
      different.players.player1.drawPile,
    );
  });

  it("为双方生成40个独立实例并抽取5张起手", () => {
    const state = createGame(gameContent, config);
    expect(Object.keys(state.cardInstances)).toHaveLength(80);
    for (const player of Object.values(state.players)) {
      expect(player.hand).toHaveLength(5);
      expect(player.drawPile).toHaveLength(35);
      expect(new Set([...player.hand, ...player.drawPile]).size).toBe(40);
    }
  });

  it("调度时先补牌，再将选中的牌洗回牌库", () => {
    const state = createGame(gameContent, config);
    const selected = state.players.player1.hand.slice(0, 2);
    const result = applyGameCommand(state, {
      type: "SUBMIT_MULLIGAN",
      playerId: "player1",
      cardInstanceIds: selected,
    }, gameContent);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.player1.hand).toHaveLength(5);
    expect(result.state.players.player1.drawPile).toHaveLength(35);
    expect(selected.every((id) => !result.state.players.player1.hand.includes(id))).toBe(
      true,
    );
    expect(selected.every((id) => result.state.players.player1.drawPile.includes(id))).toBe(
      true,
    );
    expect(result.state.status).toBe("handoff");
    expect(result.state.handoff?.nextPlayer).toBe("player2");
  });

  it("拒绝超过2张、重复或非手牌的调度选择", () => {
    const state = createGame(gameContent, config);
    const original = structuredClone(state);
    const tooMany = applyGameCommand(state, {
      type: "SUBMIT_MULLIGAN",
      playerId: "player1",
      cardInstanceIds: state.players.player1.hand.slice(0, 3),
    }, gameContent);
    expect(tooMany.ok).toBe(false);
    expect(state).toEqual(original);

    const duplicate = applyGameCommand(state, {
      type: "SUBMIT_MULLIGAN",
      playerId: "player1",
      cardInstanceIds: [state.players.player1.hand[0], state.players.player1.hand[0]],
    }, gameContent);
    expect(duplicate.ok).toBe(false);
  });

  it("正确执行先后手首回合DP和抽牌差异", () => {
    let state = finishMulligans(createGame(gameContent, config));
    expect(state.phase).toBe("ready");
    expect(state.activePlayer).toBe("player1");

    state = advance(state, "player1");
    expect(state.players.player1.maxDp).toBe(2);
    expect(state.players.player1.availableDp).toBe(2);
    expect(state.phase).toBe("draw");

    state = advance(state, "player1");
    expect(state.players.player1.hand).toHaveLength(5);
    expect(state.phase).toBe("main");
    state = advance(state, "player1");
    state = advance(state, "player1");
    expect(state.status).toBe("handoff");

    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = advance(state, "player2");
    expect(state.players.player2.maxDp).toBe(3);
    state = advance(state, "player2");
    expect(state.players.player2.hand).toHaveLength(6);
  });

  it("后续准备阶段增加2点DP且不超过10", () => {
    let state = finishMulligans(createGame(gameContent, config));

    for (let turn = 0; turn < 12; turn += 1) {
      const playerId = state.activePlayer;
      state = advance(state, playerId);
      state = advance(state, playerId);
      state = advance(state, playerId);
      state = advance(state, playerId);
      const nextPlayer = state.handoff?.nextPlayer;
      if (!nextPlayer) throw new Error("缺少交接玩家");
      state = command(state, { type: "CONFIRM_HANDOFF", playerId: nextPlayer });
    }

    expect(state.players.player1.maxDp).toBe(10);
    expect(state.players.player2.maxDp).toBe(10);
  });

  it("必须抽牌但牌库为空时立即判负", () => {
    let state = finishMulligans(createGame(gameContent, config));
    state = advance(state, "player1");
    state = advance(state, "player1");
    state = advance(state, "player1");
    state = advance(state, "player1");
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = advance(state, "player2");
    state.players.player2.drawPile = [];
    state = advance(state, "player2");
    expect(state.status).toBe("finished");
    expect(state.winner).toBe("player1");
    expect(state.finishReason).toBe("deck_out");
  });

  it("拒绝非当前玩家推进阶段且不修改原状态", () => {
    const state = finishMulligans(createGame(gameContent, config));
    const original = structuredClone(state);
    const result = applyGameCommand(state, {
      type: "ADVANCE_PHASE",
      playerId: "player2",
    }, gameContent);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(state);
    expect(state).toEqual(original);
  });

  it("可以保存和恢复经过校验的对局快照", () => {
    const data = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    };
    const state = finishMulligans(createGame(gameContent, config));
    saveGameSnapshot(storage, state);
    expect(loadGameSnapshot(storage, gameContent)).toEqual(state);

    data.set(GAME_SNAPSHOT_KEY, "{invalid-json");
    expect(loadGameSnapshot(storage, gameContent)).toBeNull();
  });

  it("在主要阶段支付DP并将干员部署到指定空位", () => {
    let state = reachMainPhase(finishMulligans(createGame(gameContent, config)));
    const { instanceId, card } = putOperatorInHand(state, "player1", 2);
    const beforeDp = state.players.player1.availableDp;

    state = command(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: instanceId,
      slotIndex: 3,
    });

    expect(state.players.player1.availableDp).toBe(beforeDp - card.cost);
    expect(state.players.player1.hand).not.toContain(instanceId);
    expect(state.players.player1.deploymentSlots[3]).toEqual({
      instanceId,
      currentLife: card.life,
      isUpright: true,
      deployedTurn: state.turnNumber,
      atkModifier: 0,
      defModifier: 0,
    });
    expect(state.log.at(-1)?.kind).toBe("operator_deployed");
  });

  it("拒绝非法部署且不修改原状态", () => {
    const state = reachMainPhase(finishMulligans(createGame(gameContent, config)));
    const { instanceId } = putOperatorInHand(state, "player1", 2);
    state.players.player1.availableDp = 0;
    const original = structuredClone(state);

    const noDp = applyGameCommand(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: instanceId,
      slotIndex: 0,
    }, gameContent);
    expect(noDp.ok).toBe(false);
    expect(state).toEqual(original);

    const invalidSlot = applyGameCommand(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: instanceId,
      slotIndex: 7,
    }, gameContent);
    expect(invalidSlot.ok).toBe(false);
    expect(state).toEqual(original);
  });

  it("拒绝部署非干员卡或占用已有部署位", () => {
    let state = reachMainPhase(finishMulligans(createGame(gameContent, config)));
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;
    const player = state.players.player1;
    const nonOperatorId = [...player.hand, ...player.drawPile].find((instanceId) => {
      const definitionId = state.cardInstances[instanceId].definitionId;
      return gameContent.cards.find((card) => card.id === definitionId)?.type !== "operator";
    });
    if (!nonOperatorId) throw new Error("测试预组缺少非干员卡");
    if (!player.hand.includes(nonOperatorId)) {
      const index = player.drawPile.indexOf(nonOperatorId);
      [player.hand[0], player.drawPile[index]] = [player.drawPile[index], player.hand[0]];
    }
    const nonOperator = applyGameCommand(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: nonOperatorId,
      slotIndex: 0,
    }, gameContent);
    expect(nonOperator.ok).toBe(false);

    const first = putOperatorInHand(state, "player1", 10);
    state = command(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: first.instanceId,
      slotIndex: 0,
    });
    const second = putOperatorInHand(state, "player1", 10, [first.instanceId]);
    const occupiedState = structuredClone(state);
    const occupied = applyGameCommand(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: second.instanceId,
      slotIndex: 0,
    }, gameContent);
    expect(occupied.ok).toBe(false);
    expect(state).toEqual(occupiedState);
  });

  it("禁止刚部署干员撤退，并在后续回合完成撤退与再部署回手", () => {
    let state = reachMainPhase(finishMulligans(createGame(gameContent, config)));
    const first = putOperatorInHand(state, "player1", 2);
    state = command(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: first.instanceId,
      slotIndex: 0,
    });

    const immediateRetreat = applyGameCommand(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    }, gameContent);
    expect(immediateRetreat.ok).toBe(false);

    state = advance(state, "player1");
    state = advance(state, "player1");
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = reachMainPhase(state);
    state = advance(state, "player2");
    state = advance(state, "player2");
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player1" });
    state = reachMainPhase(state);

    const second = putOperatorInHand(
      state,
      "player1",
      state.players.player1.availableDp,
      [first.instanceId],
    );
    state = command(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: second.instanceId,
      slotIndex: 1,
    });
    const beforeRefund = state.players.player1.availableDp;
    state = command(state, {
      type: "RETREAT_OPERATOR",
      playerId: "player1",
      slotIndex: 0,
    });

    expect(state.players.player1.deploymentSlots[0]).toBeNull();
    expect(state.players.player1.availableDp).toBe(
      Math.min(state.players.player1.maxDp, beforeRefund + first.card.retreatRefund),
    );
    expect(state.players.player1.redeployZone).toContainEqual({
      instanceId: first.instanceId,
      remainingCd: 1,
      source: "retreat",
    });

    // 模块5.2会暂停在真实触发队列；本用例继续验证模块3的CD流程。
    state.triggerQueue = [];

    state = advance(state, "player1");
    state = advance(state, "player1");
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = reachMainPhase(state);
    state = advance(state, "player2");
    state = advance(state, "player2");
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player1" });
    state = advance(state, "player1");

    expect(state.players.player1.redeployZone).toHaveLength(0);
    expect(state.players.player1.hand).toContain(first.instanceId);
    expect(state.log.at(-2)?.kind).toBe("redeploy_ready");
  });

  it("按照地面与高台站位计算合法攻击目标", () => {
    const state = createCombatState();
    putOperatorOnBoard(state, "player1", "芬", 0);
    putOperatorOnBoard(state, "player1", "克洛丝", 1);
    putOperatorOnBoard(state, "player2", "整合运动士兵", 0);
    putOperatorOnBoard(state, "player2", "高能源石虫", 1, {
      isUpright: false,
    });

    expect(getLegalAttackTargets(state, gameContent, "player1", 0)).toEqual([
      { kind: "shield" },
      { kind: "operator", slotIndex: 1 },
    ]);
    expect(getLegalAttackTargets(state, gameContent, "player1", 1)).toEqual([
      { kind: "operator", slotIndex: 0 },
      { kind: "operator", slotIndex: 1 },
    ]);

    state.players.player1.deploymentSlots[0]!.deployedTurn = state.turnNumber;
    expect(getLegalAttackTargets(state, gameContent, "player1", 0)).toEqual([]);
    state.players.player1.deploymentSlots[1]!.isUpright = false;
    expect(getLegalAttackTargets(state, gameContent, "player1", 1)).toEqual([]);
  });

  it("宣告攻击时横置攻击者并交接防守玩家", () => {
    let state = createCombatState();
    putOperatorOnBoard(state, "player1", "芬", 0);
    state = command(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "shield" },
    });

    expect(state.players.player1.deploymentSlots[0]?.isUpright).toBe(false);
    expect(state.status).toBe("handoff");
    expect(state.handoff).toEqual({
      nextPlayer: "player2",
      resume: "defend_attack",
    });
    expect(state.pendingAttack?.target).toEqual({ kind: "shield" });

    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    expect(state.status).toBe("defending");
    expect(state.currentViewer).toBe("player2");
  });

  it("理智盾攻击可由竖置地面干员拦截并完成战斗结算", () => {
    let state = createCombatState();
    putOperatorOnBoard(state, "player1", "芬", 0);
    putOperatorOnBoard(state, "player2", "整合运动士兵", 2);
    state = command(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "shield" },
    });
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    expect(getLegalInterceptors(state, gameContent)).toEqual([2]);

    state = command(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: 2,
    });
    expect(state.players.player2.shields).toBe(5);
    expect(state.players.player2.deploymentSlots[2]).toMatchObject({
      currentLife: 1,
      isUpright: false,
    });
    expect(state.status).toBe("handoff");
    expect(state.handoff?.resume).toBe("resume_main");

    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player1" });
    expect(state.status).toBe("playing");
    expect(state.phase).toBe("main");
  });

  it("攻击干员时只有另一名带拦截能力的竖置干员可以拦截", () => {
    let state = createCombatState();
    putOperatorOnBoard(state, "player1", "克洛丝", 0);
    putOperatorOnBoard(state, "player2", "整合运动士兵", 1);
    putOperatorOnBoard(state, "player2", "整合运动轻甲卫兵", 2);
    putOperatorOnBoard(state, "player2", "高能源石虫", 3);
    state = command(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "operator", slotIndex: 1 },
    });
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });

    expect(getLegalInterceptors(state, gameContent)).toEqual([2]);
    state = command(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: 2,
    });
    expect(state.players.player2.deploymentSlots[1]?.currentLife).toBe(2);
    expect(state.players.player2.deploymentSlots[2]).toMatchObject({
      currentLife: 2,
      isUpright: false,
    });
  });

  it("ATK未高于DEF时不造成生命损失，击溃时按卡面CD进入候场", () => {
    let blocked = createCombatState();
    putOperatorOnBoard(blocked, "player1", "芬", 0);
    putOperatorOnBoard(blocked, "player2", "整合运动轻甲卫兵", 0);
    blocked.players.player2.deploymentSlots[0]!.isUpright = false;
    blocked = command(blocked, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "operator", slotIndex: 0 },
    });
    blocked = command(blocked, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    blocked = command(blocked, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });
    expect(blocked.players.player2.deploymentSlots[0]?.currentLife).toBe(3);
    expect(blocked.log.at(-1)?.kind).toBe("attack_blocked");

    let defeated = createCombatState();
    putOperatorOnBoard(defeated, "player1", "玫兰莎", 0);
    const target = putOperatorOnBoard(
      defeated,
      "player2",
      "整合运动士兵",
      0,
      { currentLife: 1, isUpright: false },
    );
    defeated = command(defeated, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "operator", slotIndex: 0 },
    });
    defeated = command(defeated, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    defeated = command(defeated, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });
    expect(defeated.players.player2.deploymentSlots[0]).toBeNull();
    expect(defeated.players.player2.redeployZone).toContainEqual({
      instanceId: target.instanceId,
      remainingCd: target.card.redeployCd,
      source: "defeat",
    });
  });

  it("未拦截的理智攻击移除理智盾，最后一个理智盾触发胜利", () => {
    let state = createCombatState();
    putOperatorOnBoard(state, "player1", "芬", 0);
    state.players.player2.shields = 1;
    state = command(state, {
      type: "DECLARE_ATTACK",
      playerId: "player1",
      attackerSlotIndex: 0,
      target: { kind: "shield" },
    });
    state = command(state, { type: "CONFIRM_HANDOFF", playerId: "player2" });
    state = command(state, {
      type: "RESOLVE_ATTACK",
      playerId: "player2",
      interceptSlotIndex: null,
    });

    expect(state.players.player2.shields).toBe(0);
    expect(state.status).toBe("finished");
    expect(state.phase).toBe("finished");
    expect(state.winner).toBe("player1");
    expect(state.finishReason).toBe("shields_depleted");
  });
});
