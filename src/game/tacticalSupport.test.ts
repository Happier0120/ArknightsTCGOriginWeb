import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import {
  applyGameCommand,
  createGame,
  getDeploymentCost,
  getLegalTacticalSupportTargets,
  getTacticalSupportPlayOptions,
} from "./engine";
import { getEffectUsageCount } from "./ongoingEffects";
import { getCurrentOperatorStats } from "./operators";
import type { GameState } from "./schema";

function createMainState(
  player1DeckId = "RI-MVP",
  player2DeckId = "RM-MVP",
) {
  const state = createGame(gameContent, {
    player1DeckId,
    player2DeckId,
    firstPlayer: "player1",
    seed: `module-6-1-${player1DeckId}`,
  });
  state.status = "playing";
  state.phase = "main";
  state.turnNumber = 3;
  state.activePlayer = "player1";
  state.currentViewer = "player1";
  state.players.player1.maxDp = 10;
  state.players.player1.availableDp = 10;
  return state;
}

function moveCardToHand(state: GameState, definitionId: string) {
  const player = state.players.player1;
  const instanceId = Object.values(state.cardInstances).find(
    (instance) =>
      instance.owner === "player1" && instance.definitionId === definitionId,
  )?.id;
  if (!instanceId) throw new Error(`找不到卡牌 ${definitionId}`);
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  player.hand.push(instanceId);
  return instanceId;
}

function takeInstance(state: GameState, definitionId: string, excluded: string[] = []) {
  const instanceId = Object.values(state.cardInstances).find(
    (instance) =>
      instance.owner === "player1" &&
      instance.definitionId === definitionId &&
      !excluded.includes(instance.id),
  )?.id;
  if (!instanceId) throw new Error(`找不到卡牌 ${definitionId}`);
  const player = state.players.player1;
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  player.discardPile = player.discardPile.filter((id) => id !== instanceId);
  player.redeployZone = player.redeployZone.filter(
    (entry) => entry.instanceId !== instanceId,
  );
  return instanceId;
}

function deployFixtureOperator(
  state: GameState,
  definitionId: string,
  slotIndex: number,
) {
  const instanceId = moveCardToHand(state, definitionId);
  const player = state.players.player1;
  player.hand = player.hand.filter((id) => id !== instanceId);
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("测试干员无效");
  player.deploymentSlots[slotIndex] = {
    instanceId,
    currentLife: card.life,
    isUpright: true,
    deployedTurn: 1,
    atkModifier: 0,
    defModifier: 0,
  };
  return { instanceId, card };
}

describe("模块6.1战术支援卡基础链路", () => {
  it.each([
    ["RI-MVP", "RM-MVP", "RI-S005", "RI-O001", "RI-E017", "集中火力"],
    ["RM-MVP", "RI-MVP", "RM-S004", "RM-O001", "RM-E015", "集中突击"],
  ])(
    "%s 可以使用%s并令己方干员本回合ATK提高2",
    (player1DeckId, player2DeckId, supportId, operatorId, effectId, supportName) => {
      const state = createMainState(player1DeckId, player2DeckId);
      const supportInstanceId = moveCardToHand(state, supportId);
      const target = deployFixtureOperator(state, operatorId, 2);
      const before = structuredClone(state);
      const baseStats = getCurrentOperatorStats(gameContent, state, "player1", 2);

      expect(
        getLegalTacticalSupportTargets(
          state,
          gameContent,
          "player1",
          supportInstanceId,
        ),
      ).toEqual([2]);

      const result = applyGameCommand(state, {
        type: "PLAY_TACTICAL_SUPPORT",
        playerId: "player1",
        cardInstanceId: supportInstanceId,
        target: { kind: "operator", slotIndex: 2 },
      }, gameContent);

      expect(result.ok).toBe(true);
      expect(state).toEqual(before);
      if (!result.ok) return;
      expect(result.state.players.player1.availableDp).toBe(9);
      expect(result.state.players.player1.hand).not.toContain(supportInstanceId);
      expect(result.state.players.player1.discardPile).toContain(supportInstanceId);
      expect(result.state.ongoingEffects).toContainEqual(expect.objectContaining({
        kind: "stat_modifier",
        effectId,
        sourceInstanceId: supportInstanceId,
        targetInstanceId: target.instanceId,
        atkDelta: 2,
        defDelta: 0,
        expires: { kind: "turn_end", turnNumber: 3 },
      }));
      expect(
        getCurrentOperatorStats(gameContent, result.state, "player1", 2)?.atk,
      ).toBe((baseStats?.atk ?? 0) + 2);
      expect(result.events[0].message).toContain(`使用「${supportName}」`);
    },
  );

  it("回合结束时移除战术支援提供的ATK修正", () => {
    let state = createMainState();
    const supportInstanceId = moveCardToHand(state, "RI-S005");
    deployFixtureOperator(state, "RI-O001", 0);
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportInstanceId,
      target: { kind: "operator", slotIndex: 0 },
    }, gameContent);
    if (!played.ok) throw new Error(played.error);
    state = played.state;
    expect(getCurrentOperatorStats(gameContent, state, "player1", 0)?.atk).toBe(4);

    const endedMain = applyGameCommand(state, {
      type: "ADVANCE_PHASE",
      playerId: "player1",
    }, gameContent);
    if (!endedMain.ok) throw new Error(endedMain.error);
    const endedTurn = applyGameCommand(endedMain.state, {
      type: "ADVANCE_PHASE",
      playerId: "player1",
    }, gameContent);
    if (!endedTurn.ok) throw new Error(endedTurn.error);

    expect(endedTurn.state.ongoingEffects).toHaveLength(0);
    expect(
      getCurrentOperatorStats(gameContent, endedTurn.state, "player1", 0)?.atk,
    ).toBe(2);
  });

  it("拒绝条件不满足的支援卡、空目标和DP不足，失败时不修改状态", () => {
    const state = createMainState();
    const unsupportedId = moveCardToHand(state, "RI-S003");
    const unsupportedBefore = structuredClone(state);
    const unsupported = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: unsupportedId,
      target: { kind: "operator", slotIndex: 0 },
    }, gameContent);
    expect(unsupported.ok).toBe(false);
    expect(state).toEqual(unsupportedBefore);

    const supportId = moveCardToHand(state, "RI-S005");
    const emptyTarget = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
      target: { kind: "operator", slotIndex: 0 },
    }, gameContent);
    expect(emptyTarget.ok).toBe(false);

    deployFixtureOperator(state, "RI-O001", 0);
    state.players.player1.availableDp = 0;
    expect(
      getLegalTacticalSupportTargets(state, gameContent, "player1", supportId),
    ).toEqual([]);
    const noDp = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
      target: { kind: "operator", slotIndex: 0 },
    }, gameContent);
    expect(noDp.ok).toBe(false);
  });

  it("人员调度可以从牌库顶四张选择合格干员，并自定义其余牌库底顺序", () => {
    let state = createMainState();
    const supportId = moveCardToHand(state, "RI-S001");
    const topCards = ["RI-O001", "RI-O005", "RI-S002", "RI-F001"].map(
      (definitionId) => takeInstance(state, definitionId, [supportId]),
    );
    state.players.player1.drawPile = [
      ...topCards,
      ...state.players.player1.drawPile.filter((id) => !topCards.includes(id)),
    ];

    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingTacticalSupport).toMatchObject({
      kind: "deck_search_choice",
      revealedInstanceIds: topCards,
      maximumOperatorCost: 4,
    });
    expect(played.state.players.player1.drawPile).not.toEqual(
      expect.arrayContaining(topCards),
    );

    const chosen = applyGameCommand(played.state, {
      type: "RESOLVE_TACTICAL_SUPPORT",
      playerId: "player1",
      action: { type: "CHOOSE_SEARCH_RESULT", instanceId: topCards[0] },
    }, gameContent);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.state.players.player1.hand).toContain(topCards[0]);
    expect(chosen.state.pendingTacticalSupport?.kind).toBe("deck_search_order");

    const bottomOrder = [topCards[3], topCards[2], topCards[1]];
    const ordered = applyGameCommand(chosen.state, {
      type: "RESOLVE_TACTICAL_SUPPORT",
      playerId: "player1",
      action: { type: "ORDER_SEARCH_REMAINDER", instanceIds: bottomOrder },
    }, gameContent);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.state.pendingTacticalSupport).toBeNull();
    expect(ordered.state.players.player1.drawPile.slice(-3)).toEqual(bottomOrder);
  });

  it("队伍集结只允许检索费用不高于3的整合运动干员", () => {
    const state = createMainState("RM-MVP", "RI-MVP");
    const supportId = moveCardToHand(state, "RM-S001");
    const eligibleId = takeInstance(state, "RM-O002", [supportId]);
    const expensiveId = takeInstance(state, "RM-O004", [supportId, eligibleId]);
    state.players.player1.drawPile = [
      eligibleId,
      expensiveId,
      ...state.players.player1.drawPile,
    ];
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingTacticalSupport).toMatchObject({
      kind: "deck_search_choice",
      maximumOperatorCost: 3,
    });
    const invalid = applyGameCommand(played.state, {
      type: "RESOLVE_TACTICAL_SUPPORT",
      playerId: "player1",
      action: { type: "CHOOSE_SEARCH_RESULT", instanceId: expensiveId },
    }, gameContent);
    expect(invalid.ok).toBe(false);
    const valid = applyGameCommand(played.state, {
      type: "RESOLVE_TACTICAL_SUPPORT",
      playerId: "player1",
      action: { type: "CHOOSE_SEARCH_RESULT", instanceId: eligibleId },
    }, gameContent);
    expect(valid.ok).toBe(true);
  });

  it("作战简报抽2张后暂停结算，选择并弃置1张手牌", () => {
    const state = createMainState();
    const supportId = moveCardToHand(state, "RI-S002");
    const handBefore = state.players.player1.hand.length;
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.pendingTacticalSupport?.kind).toBe("discard_after_draw");
    expect(played.state.players.player1.hand).toHaveLength(handBefore + 1);

    const discardId = played.state.players.player1.hand[0];
    const resolved = applyGameCommand(played.state, {
      type: "RESOLVE_TACTICAL_SUPPORT",
      playerId: "player1",
      action: { type: "DISCARD_HAND_CARD", instanceId: discardId },
    }, gameContent);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.pendingTacticalSupport).toBeNull();
    expect(resolved.state.players.player1.discardPile).toEqual(
      expect.arrayContaining([supportId, discardId]),
    );
  });

  it("行动复盘要求本回合主动撤退，并执行每回合同名卡限一次", () => {
    let state = createMainState();
    const firstId = moveCardToHand(state, "RI-S003");
    const secondId = takeInstance(state, "RI-S003", [firstId]);
    state.players.player1.hand.push(secondId);
    expect(
      getTacticalSupportPlayOptions(state, gameContent, "player1", firstId),
    ).toMatchObject({ kind: "unavailable" });

    state.turnFacts.player1.retreatedOperatorIds.push(
      takeInstance(state, "RI-O001"),
    );
    const handBefore = state.players.player1.hand.length;
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: firstId,
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players.player1.hand).toHaveLength(handBefore + 1);
    expect(getEffectUsageCount(played.state, "player1", "RI-E015")).toBe(1);
    expect(
      getTacticalSupportPlayOptions(
        played.state,
        gameContent,
        "player1",
        secondId,
      ),
    ).toMatchObject({ kind: "unavailable", reason: "本回合已经使用过同名卡" });
  });

  it("重返战线将CD为1的干员返回手牌，并只为该卡下一次部署减费", () => {
    let state = createMainState();
    const supportId = moveCardToHand(state, "RI-S004");
    const fenId = takeInstance(state, "RI-O001", [supportId]);
    state.players.player1.redeployZone.push({
      instanceId: fenId,
      remainingCd: 1,
      source: "defeat",
    });
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
      target: { kind: "redeploy", instanceId: fenId },
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    state = played.state;
    expect(state.players.player1.hand).toContain(fenId);
    expect(state.players.player1.redeployZone).toHaveLength(0);
    expect(getDeploymentCost(state, gameContent, fenId)).toBe(1);

    const dpBefore = state.players.player1.availableDp;
    const deployed = applyGameCommand(state, {
      type: "DEPLOY_OPERATOR",
      playerId: "player1",
      cardInstanceId: fenId,
      slotIndex: 0,
    }, gameContent);
    expect(deployed.ok).toBe(true);
    if (!deployed.ok) return;
    expect(deployed.state.players.player1.availableDp).toBe(dpBefore - 1);
    expect(getDeploymentCost(deployed.state, gameContent, fenId)).toBe(2);
  });

  it("后续梯队只接回费用不高于3的整合运动候场干员", () => {
    const state = createMainState("RM-MVP", "RI-MVP");
    const supportId = moveCardToHand(state, "RM-S003");
    const cheapId = takeInstance(state, "RM-O002", [supportId]);
    const expensiveId = takeInstance(state, "RM-O004", [supportId, cheapId]);
    state.players.player1.redeployZone.push(
      { instanceId: cheapId, remainingCd: 1, source: "defeat" },
      { instanceId: expensiveId, remainingCd: 1, source: "defeat" },
    );
    expect(
      getTacticalSupportPlayOptions(state, gameContent, "player1", supportId),
    ).toEqual({ kind: "redeploy", instanceIds: [cheapId] });
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
      target: { kind: "redeploy", instanceId: cheapId },
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(getDeploymentCost(played.state, gameContent, cheapId)).toBe(1);
    expect(played.state.players.player1.redeployZone).toContainEqual({
      instanceId: expensiveId,
      remainingCd: 1,
      source: "defeat",
    });
  });

  it("战地搜集击溃己方竖置干员作为附加费用，再抽2张牌并产生击溃触发", () => {
    const state = createMainState("RM-MVP", "RI-MVP");
    const supportId = moveCardToHand(state, "RM-S002");
    const sacrificed = deployFixtureOperator(state, "RM-O001", 1);
    const handBefore = state.players.player1.hand.length;
    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: supportId,
      target: { kind: "sacrifice", slotIndex: 1 },
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players.player1.deploymentSlots[1]).toBeNull();
    expect(played.state.players.player1.redeployZone).toContainEqual({
      instanceId: sacrificed.instanceId,
      remainingCd: sacrificed.card.redeployCd,
      source: "defeat",
    });
    expect(played.state.players.player1.hand).toHaveLength(handBefore + 1);
    expect(played.state.turnFacts.player1.defeatedOperatorIds).toContain(
      sacrificed.instanceId,
    );
    expect(played.state.triggerQueue.map((trigger) => trigger.effectId)).toContain(
      "RM-E002",
    );
  });

  it("回收补给在本回合发生击溃后，将废弃区中非同名支援卡返回手牌", () => {
    const state = createMainState("RM-MVP", "RI-MVP");
    const recycleId = moveCardToHand(state, "RM-S005");
    const targetId = takeInstance(state, "RM-S004", [recycleId]);
    state.players.player1.discardPile.push(targetId);
    state.turnFacts.player1.defeatedOperatorIds.push(
      takeInstance(state, "RM-O001"),
    );

    const played = applyGameCommand(state, {
      type: "PLAY_TACTICAL_SUPPORT",
      playerId: "player1",
      cardInstanceId: recycleId,
      target: { kind: "discard_support", instanceId: targetId },
    }, gameContent);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.players.player1.hand).toContain(targetId);
    expect(played.state.players.player1.discardPile).toContain(recycleId);
    expect(played.state.players.player1.discardPile).not.toContain(targetId);
  });
});
