import type { GameContent } from "../content";
import { executeEffectInstructions, type EffectInstruction } from "./effects";
import { addOngoingEffect, recordEffectUsage } from "./ongoingEffects";
import { getOperatorDefinition } from "./operators";
import type {
  CommandResult,
  GameEvent,
  GameState,
  PendingTrigger,
  PlayerId,
  TriggerTarget,
} from "./schema";

const targetedEffectIds = new Set([
  "RI-E005",
  "RI-E007",
  "RI-E011",
  "RM-E003",
  "RM-E005",
  "RM-E006",
  "RM-E007",
  "RM-E008",
  "RI-E018",
  "RM-E017",
]);

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

const playerLabel = (playerId: PlayerId) =>
  playerId === "player1" ? "玩家1" : "玩家2";

function appendEvents(state: GameState, events: GameEvent[]) {
  for (const event of events) {
    state.log.push({ id: state.log.length + 1, ...event });
  }
}

function fail(state: GameState, error: string): CommandResult {
  return { ok: false, state, error, events: [] };
}

function targetEquals(left: TriggerTarget, right: TriggerTarget) {
  if (left.kind !== right.kind || left.playerId !== right.playerId) return false;
  if (left.kind === "operator" && right.kind === "operator") {
    return left.slotIndex === right.slotIndex;
  }
  return left.kind === "redeploy" && right.kind === "redeploy"
    ? left.instanceId === right.instanceId
    : false;
}

function operatorTargets(
  state: GameState,
  playerId: PlayerId,
  predicate: (deployed: NonNullable<GameState["players"][PlayerId]["deploymentSlots"][number]>) => boolean,
): TriggerTarget[] {
  return state.players[playerId].deploymentSlots.flatMap((deployed, slotIndex) =>
    deployed && predicate(deployed)
      ? [{ kind: "operator" as const, playerId, slotIndex }]
      : [],
  );
}

export function getLegalTriggerTargets(
  state: GameState,
  content: GameContent,
  trigger: PendingTrigger,
): TriggerTarget[] {
  const opponentId = otherPlayer(trigger.controllerId);
  if (trigger.effectId === "RI-E005" || trigger.effectId === "RM-E005") {
    return operatorTargets(state, opponentId, (deployed) => !deployed.isUpright);
  }
  if (trigger.effectId === "RI-E007" || trigger.effectId === "RM-E008") {
    return operatorTargets(state, opponentId, () => true);
  }
  if (trigger.effectId === "RM-E006") {
    return operatorTargets(state, opponentId, (deployed) => {
      const card = getOperatorDefinition(content, state, deployed.instanceId);
      return card?.position === "ground";
    });
  }
  if (trigger.effectId === "RM-E007") {
    return operatorTargets(
      state,
      trigger.controllerId,
      (deployed) => {
        const card = getOperatorDefinition(content, state, deployed.instanceId);
        return Boolean(
          deployed.instanceId !== trigger.sourceInstanceId &&
          deployed.isUpright &&
          card?.faction === "reunion",
        );
      },
    );
  }
  if (trigger.effectId === "RI-E011") {
    return state.players[trigger.controllerId].redeployZone.map((entry) => ({
      kind: "redeploy" as const,
      playerId: trigger.controllerId,
      instanceId: entry.instanceId,
    }));
  }
  if (trigger.effectId === "RM-E003") {
    return state.players[trigger.controllerId].redeployZone.flatMap((entry) => {
      if (entry.instanceId === trigger.sourceInstanceId) return [];
      const card = getOperatorDefinition(content, state, entry.instanceId);
      return card && card.faction === "reunion" && card.cost <= 3
        ? [{
            kind: "redeploy" as const,
            playerId: trigger.controllerId,
            instanceId: entry.instanceId,
          }]
        : [];
    });
  }
  if (trigger.effectId === "RI-E018") {
    return operatorTargets(state, trigger.controllerId, (deployed) => {
      const card = getOperatorDefinition(content, state, deployed.instanceId);
      return Boolean(card && deployed.currentLife < card.life);
    });
  }
  if (trigger.effectId === "RM-E017") {
    return state.players[trigger.controllerId].redeployZone.flatMap((entry) => {
      if (entry.instanceId === trigger.event.subjectInstanceId) return [];
      const card = getOperatorDefinition(content, state, entry.instanceId);
      return card?.faction === "reunion"
        ? [{
            kind: "redeploy" as const,
            playerId: trigger.controllerId,
            instanceId: entry.instanceId,
          }]
        : [];
    });
  }
  return [];
}

export function confirmTriggerHandoff(
  state: GameState,
  playerId: PlayerId,
): CommandResult {
  const trigger = state.triggerQueue[0];
  if (!trigger) return fail(state, "当前没有待结算的触发能力");
  if (trigger.controllerId !== playerId) {
    return fail(state, "只有下一项能力的控制者可以接手");
  }
  const next = structuredClone(state);
  next.currentViewer = playerId;
  const events: GameEvent[] = [];
  return { ok: true, state: next, events };
}

function completeTrigger(state: GameState) {
  state.triggerQueue.shift();
  if (state.triggerQueue.length === 0) {
    if (state.triggerResumeViewer) state.currentViewer = state.triggerResumeViewer;
    state.triggerResumeViewer = null;
  }
}

function resolveNoLegalTarget(
  state: GameState,
  trigger: PendingTrigger,
): CommandResult {
  const next = structuredClone(state);
  completeTrigger(next);
  const events: GameEvent[] = [{
    kind: "trigger_no_legal_target",
    playerId: trigger.controllerId,
    message: `${playerLabel(trigger.controllerId)}控制的能力没有合法目标，结束结算。`,
  }];
  appendEvents(next, events);
  return { ok: true, state: next, events };
}

function finishWithInstructions(
  state: GameState,
  trigger: PendingTrigger,
  instructions: EffectInstruction[],
  content: GameContent,
  activationEvent: GameEvent,
): CommandResult {
  const next = structuredClone(state);
  completeTrigger(next);
  appendEvents(next, [activationEvent]);
  const result = executeEffectInstructions(next, instructions, content);
  if (!result.ok) return fail(state, result.error);
  if (result.state.status === "finished") {
    result.state.triggerQueue = [];
    result.state.triggerResumeViewer = null;
  }
  return {
    ok: true,
    state: result.state,
    events: [activationEvent, ...result.events],
  };
}

export function resolveTrigger(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  triggerId: number,
  action: "activate" | "skip",
  target?: TriggerTarget,
  discardInstanceId?: string,
): CommandResult {
  const trigger = state.triggerQueue[0];
  if (!trigger || trigger.id !== triggerId) {
    return fail(state, "只能结算队列中的第一项能力");
  }
  if (trigger.controllerId !== playerId || state.currentViewer !== playerId) {
    return fail(state, "只有该能力的控制者可以结算");
  }

  const effect = content.effects.find((candidate) => candidate.id === trigger.effectId);
  const card = content.cards.find(
    (candidate) => candidate.id === trigger.sourceDefinitionId,
  );
  const abilityLabel = effect?.abilityName?.trim() ||
    (card?.type === "field" ? "场地效果" : "天赋");
  const activationEvent: GameEvent = {
    kind: "trigger_activated",
    playerId,
    message: `${playerLabel(playerId)}发动「${card?.name ?? trigger.sourceDefinitionId}·${abilityLabel}」。`,
  };

  if (trigger.stage === "discard_after_draw") {
    if (action !== "activate" || !discardInstanceId) {
      return fail(state, "抽牌后必须选择一张手牌弃置");
    }
    if (!state.players[playerId].hand.includes(discardInstanceId)) {
      return fail(state, "只能弃置当前手牌中的卡牌");
    }
    const next = structuredClone(state);
    next.players[playerId].hand = next.players[playerId].hand.filter(
      (instanceId) => instanceId !== discardInstanceId,
    );
    next.players[playerId].discardPile.push(discardInstanceId);
    completeTrigger(next);
    const discardedCard = content.cards.find(
      (candidate) => candidate.id === next.cardInstances[discardInstanceId]?.definitionId,
    );
    const events: GameEvent[] = [{
      kind: "effect_card_discarded",
      playerId,
      message: `${playerLabel(playerId)}弃置「${discardedCard?.name ?? "一张手牌"}」，完成触发能力结算。`,
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (action === "skip") {
    if (!trigger.optional) return fail(state, "该能力必须结算，不能跳过");
    const next = structuredClone(state);
    completeTrigger(next);
    const events: GameEvent[] = [{
      kind: "trigger_skipped",
      playerId,
      message: `${playerLabel(playerId)}选择不发动「${card?.name ?? trigger.sourceDefinitionId}·${abilityLabel}」。`,
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  const legalTargets = getLegalTriggerTargets(state, content, trigger);
  if (targetedEffectIds.has(trigger.effectId)) {
    if (legalTargets.length === 0) return resolveNoLegalTarget(state, trigger);
    if (!target || !legalTargets.some((candidate) => targetEquals(candidate, target))) {
      return fail(state, "请选择一个合法目标");
    }
  }

  if (trigger.effectId === "RI-E002") {
    const next = structuredClone(state);
    completeTrigger(next);
    addOngoingEffect(next, {
      kind: "next_deployment",
      effectId: trigger.effectId,
      controllerId: playerId,
      sourceInstanceId: trigger.sourceInstanceId,
      createdTurn: next.turnNumber,
      payload: "grant_intercept",
      requiredFaction: "rhodes_island",
      requiredPosition: "ground",
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    const events = [activationEvent];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (trigger.effectId === "RI-E004") {
    const next = structuredClone(state);
    const source = next.players[playerId].deploymentSlots.find(
      (deployed) => deployed?.instanceId === trigger.sourceInstanceId,
    );
    if (!source?.isUpright) {
      completeTrigger(next);
      const events: GameEvent[] = [{
        kind: "trigger_cost_unpaid",
        playerId,
        message: "杜宾已无法横置，能力不结算。",
      }];
      appendEvents(next, events);
      return { ok: true, state: next, events };
    }
    source.isUpright = false;
    recordEffectUsage(next, playerId, trigger.effectId);
    completeTrigger(next);
    addOngoingEffect(next, {
      kind: "next_deployment",
      effectId: trigger.effectId,
      controllerId: playerId,
      sourceInstanceId: trigger.sourceInstanceId,
      createdTurn: next.turnNumber,
      payload: "allow_attack_on_deploy_turn",
      requiredFaction: "rhodes_island",
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    const events = [activationEvent, {
      kind: "trigger_cost_paid",
      playerId,
      message: "杜宾横置；本回合下一名部署的罗德岛干员可以在部署回合攻击。",
    } satisfies GameEvent];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (trigger.effectId === "RI-E006") {
    return finishWithInstructions(state, trigger, [{
      type: "lose_shields",
      playerId: trigger.event.subjectPlayerId,
      amount: 1,
    }], content, activationEvent);
  }

  if (trigger.effectId === "RM-E002") {
    const next = structuredClone(state);
    appendEvents(next, [activationEvent]);
    const result = executeEffectInstructions(next, [{
      type: "draw_cards",
      playerId,
      amount: 1,
    }], content);
    if (!result.ok) return fail(state, result.error);
    if (result.state.status === "finished") {
      result.state.triggerQueue = [];
      result.state.triggerResumeViewer = null;
    } else {
      result.state.triggerQueue[0].stage = "discard_after_draw";
    }
    return {
      ok: true,
      state: result.state,
      events: [activationEvent, ...result.events],
    };
  }

  if (!target) return fail(state, "该能力缺少结算目标");

  if (trigger.effectId === "RI-E005" || trigger.effectId === "RM-E005" || trigger.effectId === "RM-E008") {
    if (target.kind !== "operator") return fail(state, "目标类型无效");
    return finishWithInstructions(state, trigger, [{
      type: "damage_operator",
      playerId: target.playerId,
      slotIndex: target.slotIndex,
      amount: 1,
    }], content, activationEvent);
  }

  if (trigger.effectId === "RM-E007") {
    if (target.kind !== "operator") return fail(state, "目标类型无效");
    const deployed = state.players[target.playerId].deploymentSlots[target.slotIndex];
    if (!deployed) return fail(state, "目标已离开部署区");
    return finishWithInstructions(state, trigger, [{
      type: "damage_operator",
      playerId: target.playerId,
      slotIndex: target.slotIndex,
      amount: deployed.currentLife,
    }], content, activationEvent);
  }

  if (trigger.effectId === "RI-E007" || trigger.effectId === "RM-E006") {
    if (target.kind !== "operator") return fail(state, "目标类型无效");
    const next = structuredClone(state);
    const deployed = next.players[target.playerId].deploymentSlots[target.slotIndex];
    if (!deployed) return fail(state, "目标已离开部署区");
    addOngoingEffect(next, {
      kind: "stat_modifier",
      effectId: trigger.effectId,
      controllerId: playerId,
      sourceInstanceId: trigger.sourceInstanceId,
      targetInstanceId: deployed.instanceId,
      atkDelta: 0,
      defDelta: trigger.effectId === "RM-E006" ? -2 : -1,
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    completeTrigger(next);
    const events: GameEvent[] = [activationEvent, {
      kind: "temporary_stats_modified",
      playerId: target.playerId,
      message: `目标干员的DEF降低${trigger.effectId === "RM-E006" ? 2 : 1}，直到本回合结束。`,
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (trigger.effectId === "RI-E011") {
    if (target.kind !== "redeploy") return fail(state, "目标类型无效");
    const next = structuredClone(state);
    const player = next.players[playerId];
    const entry = player.redeployZone.find(
      (candidate) => candidate.instanceId === target.instanceId,
    );
    if (!entry) return fail(state, "目标已离开再部署候场区");
    entry.remainingCd -= 1;
    if (entry.remainingCd === 0) {
      player.redeployZone = player.redeployZone.filter(
        (candidate) => candidate.instanceId !== target.instanceId,
      );
      player.hand.push(target.instanceId);
    }
    completeTrigger(next);
    const events: GameEvent[] = [activationEvent, {
      kind: "redeploy_cd_reduced",
      playerId,
      message: entry.remainingCd === 0
        ? "目标干员的CD降至0并返回手牌。"
        : `目标干员的CD减少1，剩余${entry.remainingCd}。`,
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (trigger.effectId === "RM-E003") {
    if (target.kind !== "redeploy") return fail(state, "目标类型无效");
    const next = structuredClone(state);
    const player = next.players[playerId];
    player.redeployZone = player.redeployZone.filter(
      (entry) => entry.instanceId !== target.instanceId,
    );
    player.hand.push(target.instanceId);
    completeTrigger(next);
    const events: GameEvent[] = [activationEvent, {
      kind: "redeploy_returned_to_hand",
      playerId,
      message: "选择的整合运动干员从再部署候场区返回手牌。",
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  if (trigger.effectId === "RI-E018") {
    if (target.kind !== "operator") return fail(state, "目标类型无效");
    const next = structuredClone(state);
    recordEffectUsage(
      next,
      playerId,
      trigger.effectId,
      trigger.sourceInstanceId,
    );
    completeTrigger(next);
    appendEvents(next, [activationEvent]);
    const result = executeEffectInstructions(next, [{
      type: "heal_operator",
      playerId: target.playerId,
      slotIndex: target.slotIndex,
      amount: 1,
    }], content);
    if (!result.ok) return fail(state, result.error);
    return {
      ok: true,
      state: result.state,
      events: [activationEvent, ...result.events],
    };
  }

  if (trigger.effectId === "RM-E017") {
    if (target.kind !== "redeploy") return fail(state, "目标类型无效");
    const next = structuredClone(state);
    const player = next.players[playerId];
    const entry = player.redeployZone.find(
      (candidate) => candidate.instanceId === target.instanceId,
    );
    if (!entry) return fail(state, "目标已离开再部署候场区");
    entry.remainingCd -= 1;
    if (entry.remainingCd === 0) {
      player.redeployZone = player.redeployZone.filter(
        (candidate) => candidate.instanceId !== target.instanceId,
      );
      player.hand.push(target.instanceId);
    }
    recordEffectUsage(
      next,
      playerId,
      trigger.effectId,
      trigger.sourceInstanceId,
    );
    completeTrigger(next);
    const events: GameEvent[] = [activationEvent, {
      kind: "redeploy_cd_reduced",
      playerId,
      message: entry.remainingCd === 0
        ? "场地使目标干员的CD降至0并返回手牌。"
        : `场地使目标干员的CD减少1，剩余${entry.remainingCd}。`,
    }];
    appendEvents(next, events);
    return { ok: true, state: next, events };
  }

  return fail(state, `尚未实现能力 ${trigger.effectId} 的结算`);
}
