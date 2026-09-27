import { describe, expect, it } from "vitest";
import { gameContent } from "../content";
import { createGame } from "./engine";
import {
  addOngoingEffect,
  canUseEffect,
  consumeNextDeploymentEffects,
  expireOngoingEffects,
  getEffectUsageCount,
  getOngoingStatModifier,
  hasAttackPermission,
  hasGrantedKeyword,
  recordEffectUsage,
  removeAttachedEffects,
} from "./ongoingEffects";

function createState() {
  const state = createGame(gameContent, {
    player1DeckId: "RI-MVP",
    player2DeckId: "RM-MVP",
    firstPlayer: "player1",
    seed: "module-5-4-test",
  });
  state.turnNumber = 5;
  return state;
}

function operator(definitionId: string) {
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error("测试卡不是干员");
  return card;
}

describe("模块5.4持续效果系统", () => {
  it("将下一次部署标记消费为附着关键字，并在控制者下个准备阶段开始时到期", () => {
    const state = createState();
    addOngoingEffect(state, {
      kind: "next_deployment",
      effectId: "RI-E002",
      controllerId: "player1",
      sourceInstanceId: "fen",
      createdTurn: 5,
      payload: "grant_intercept",
      requiredFaction: "rhodes_island",
      requiredPosition: "ground",
      expires: { kind: "turn_end", turnNumber: 5 },
    });

    const events = consumeNextDeploymentEffects(
      state,
      "player1",
      operator("RI-O002"),
      "migru",
    );
    expect(events).toHaveLength(1);
    expect(hasGrantedKeyword(state, "migru", "intercept")).toBe(true);
    expect(expireOngoingEffects(state, { kind: "turn_end", turnNumber: 5 })).toHaveLength(0);
    expect(hasGrantedKeyword(state, "migru", "intercept")).toBe(true);
    expect(expireOngoingEffects(state, { kind: "ready_start", playerId: "player1" })).toHaveLength(1);
    expect(hasGrantedKeyword(state, "migru", "intercept")).toBe(false);
  });

  it("只让满足阵营条件的部署消费攻击许可，并在本回合结束时到期", () => {
    const state = createState();
    addOngoingEffect(state, {
      kind: "next_deployment",
      effectId: "RI-E004",
      controllerId: "player1",
      sourceInstanceId: "dobermann",
      createdTurn: 5,
      payload: "allow_attack_on_deploy_turn",
      requiredFaction: "rhodes_island",
      expires: { kind: "turn_end", turnNumber: 5 },
    });

    consumeNextDeploymentEffects(state, "player1", operator("RM-O001"), "soldier");
    expect(hasAttackPermission(state, "soldier", "ignore_deployment_turn")).toBe(false);
    expect(state.ongoingEffects[0]?.kind).toBe("next_deployment");

    consumeNextDeploymentEffects(state, "player1", operator("RI-O003"), "fang");
    expect(hasAttackPermission(state, "fang", "ignore_deployment_turn")).toBe(true);
    expireOngoingEffects(state, { kind: "turn_end", turnNumber: 5 });
    expect(hasAttackPermission(state, "fang", "ignore_deployment_turn")).toBe(false);
  });

  it("叠加临时属性修正，并统一按到期时点移除", () => {
    const state = createState();
    for (const defDelta of [-1, 2]) {
      addOngoingEffect(state, {
        kind: "stat_modifier",
        effectId: `fixture-${defDelta}`,
        controllerId: "player1",
        sourceInstanceId: "source",
        targetInstanceId: "target",
        atkDelta: 1,
        defDelta,
        expires: { kind: "turn_end", turnNumber: 5 },
      });
    }
    expect(getOngoingStatModifier(state, "target")).toEqual({
      atkDelta: 2,
      defDelta: 1,
    });
    expect(expireOngoingEffects(state, { kind: "turn_end", turnNumber: 5 })).toHaveLength(2);
    expect(getOngoingStatModifier(state, "target")).toEqual({
      atkDelta: 0,
      defDelta: 0,
    });
  });

  it("干员离场时清除所有附着在它身上的持续效果", () => {
    const state = createState();
    addOngoingEffect(state, {
      kind: "granted_keyword",
      effectId: "fixture-keyword",
      controllerId: "player1",
      sourceInstanceId: "source",
      targetInstanceId: "target",
      keyword: "intercept",
      expires: { kind: "ready_start", playerId: "player1" },
    });
    addOngoingEffect(state, {
      kind: "stat_modifier",
      effectId: "fixture-stat",
      controllerId: "player2",
      sourceInstanceId: "source-2",
      targetInstanceId: "target",
      atkDelta: 0,
      defDelta: -1,
      expires: { kind: "turn_end", turnNumber: 5 },
    });
    expect(removeAttachedEffects(state, "target")).toBe(2);
    expect(state.ongoingEffects).toHaveLength(0);
  });

  it("按控制者、能力和回合记录每回合限次", () => {
    const state = createState();
    expect(canUseEffect(state, "player1", "RI-E004", 1)).toBe(true);
    recordEffectUsage(state, "player1", "RI-E004");
    expect(getEffectUsageCount(state, "player1", "RI-E004")).toBe(1);
    expect(canUseEffect(state, "player1", "RI-E004", 1)).toBe(false);
    expect(canUseEffect(state, "player2", "RI-E004", 1)).toBe(true);
    state.turnNumber = 6;
    expect(canUseEffect(state, "player1", "RI-E004", 1)).toBe(true);
  });
});
