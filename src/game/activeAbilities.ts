import type { CardDefinition, GameContent } from "../content";
import {
  addOngoingEffect,
  canUseEffect,
  consumeDeploymentCostModifiers,
  consumeNextDeploymentEffects,
  recordEffectUsage,
  removeAttachedEffects,
} from "./ongoingEffects";
import {
  getCurrentOperatorStats,
  getOperatorDefinition,
  moveDefeatedOperator,
} from "./operators";
import { enqueueTriggerEvent } from "./triggers";
import type {
  ActiveAbilitySource,
  ActiveAbilityTarget,
  CommandResult,
  GameEvent,
  GameState,
  PlayerId,
  TriggerEventSnapshot,
} from "./schema";

const operatorActiveEffects: Record<string, string> = {
  "RI-O007": "RI-E008",
  "RI-O008": "RI-E009",
  "RI-O009": "RI-E010",
  "RI-O010": "RI-E012",
  "RM-O008": "RM-E009",
  "RM-O009": "RM-E010",
};

const commanderEffects: Record<string, string> = {
  "RI-C001": "RI-E001",
  "RM-C001": "RM-E001",
};

export type ActiveAbilityOptions =
  | { kind: "retreat"; slotIndexes: number[] }
  | { kind: "operator"; playerId: PlayerId; slotIndexes: number[] }
  | { kind: "redeploy"; instanceIds: string[]; maximumSelections: number }
  | { kind: "free_deploy"; instanceIds: string[]; slotIndexes: number[] }
  | {
      kind: "sacrifice_and_operator";
      sacrificeSlotIndexes: number[];
      targetPlayerId: PlayerId;
      targetSlotIndexes: number[];
      targetsMustDiffer: boolean;
    }
  | { kind: "unavailable"; reason: string };

interface AbilityContext {
  effectId: string;
  sourceCard: CardDefinition;
  sourceInstanceId: string;
  sourceSlotIndex: number | null;
}

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

const playerLabel = (playerId: PlayerId) =>
  playerId === "player1" ? "玩家1" : "玩家2";

function fail(state: GameState, error: string): CommandResult {
  return { ok: false, state, error, events: [] };
}

function success(
  state: GameState,
  content: GameContent,
  events: GameEvent[],
  triggerEvents: TriggerEventSnapshot[] = [],
): CommandResult {
  for (const event of events) {
    state.log.push({ id: state.log.length + 1, ...event });
  }
  const queueEvents = triggerEvents.flatMap((event) =>
    enqueueTriggerEvent(state, content, event),
  );
  for (const event of queueEvents) {
    state.log.push({ id: state.log.length + 1, ...event });
  }
  return { ok: true, state, events: [...events, ...queueEvents] };
}

function canActivate(state: GameState, playerId: PlayerId) {
  return (
    state.status === "playing" &&
    state.phase === "main" &&
    state.activePlayer === playerId &&
    state.currentViewer === playerId &&
    state.triggerQueue.length === 0 &&
    state.pendingTacticalSupport === null
  );
}

function getAbilityContext(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  source: ActiveAbilitySource,
): AbilityContext | null {
  const player = state.players[playerId];
  if (source.kind === "commander") {
    const sourceCard = content.cards.find((card) => card.id === player.commanderId);
    const effectId = sourceCard ? commanderEffects[sourceCard.id] : undefined;
    if (!sourceCard || sourceCard.type !== "commander" || !effectId) return null;
    return {
      effectId,
      sourceCard,
      sourceInstanceId: `commander:${playerId}:${sourceCard.id}`,
      sourceSlotIndex: null,
    };
  }
  if (
    !Number.isInteger(source.slotIndex) ||
    source.slotIndex < 0 ||
    source.slotIndex >= player.deploymentSlots.length
  ) {
    return null;
  }
  const deployed = player.deploymentSlots[source.slotIndex];
  const sourceCard = deployed
    ? getOperatorDefinition(content, state, deployed.instanceId)
    : undefined;
  const effectId = sourceCard ? operatorActiveEffects[sourceCard.id] : undefined;
  if (!deployed || !sourceCard || !effectId) return null;
  return {
    effectId,
    sourceCard,
    sourceInstanceId: deployed.instanceId,
    sourceSlotIndex: source.slotIndex,
  };
}

function deployedOperatorSlots(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  predicate: (
    deployed: NonNullable<GameState["players"][PlayerId]["deploymentSlots"][number]>,
    card: Extract<CardDefinition, { type: "operator" }>,
    slotIndex: number,
  ) => boolean,
) {
  return state.players[playerId].deploymentSlots.flatMap((deployed, slotIndex) => {
    if (!deployed) return [];
    const card = getOperatorDefinition(content, state, deployed.instanceId);
    return card && predicate(deployed, card, slotIndex) ? [slotIndex] : [];
  });
}

export function getActiveAbilityOptions(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  source: ActiveAbilitySource,
): ActiveAbilityOptions {
  if (!canActivate(state, playerId)) {
    return { kind: "unavailable", reason: "只能在自己的主要阶段发动" };
  }
  const context = getAbilityContext(state, content, playerId, source);
  if (!context) return { kind: "unavailable", reason: "该卡没有已接入的主动能力" };
  const player = state.players[playerId];

  if (source.kind === "commander") {
    if (!player.commanderIsUpright) {
      return { kind: "unavailable", reason: "指挥官已经横置" };
    }
    if (player.availableDp < 1) {
      return { kind: "unavailable", reason: "DP不足" };
    }
    if (!canUseEffect(state, playerId, context.effectId, 1)) {
      return { kind: "unavailable", reason: "本回合已经发动过指挥官指令" };
    }
  } else {
    const deployed = player.deploymentSlots[source.slotIndex];
    if (!deployed?.isUpright) {
      return { kind: "unavailable", reason: "干员已经横置" };
    }
    if (deployed.deployedTurn === state.turnNumber) {
      return { kind: "unavailable", reason: "本回合部署的干员不能发动技能" };
    }
    const dpCost =
      context.effectId === "RI-E010" ? 2 : context.effectId === "RI-E012" ? 1 : 0;
    if (player.availableDp < dpCost) {
      return { kind: "unavailable", reason: "DP不足" };
    }
  }

  if (context.effectId === "RI-E001") {
    const slotIndexes = deployedOperatorSlots(
      state,
      content,
      playerId,
      (deployed, card) =>
        !deployed.isUpright &&
        deployed.deployedTurn !== state.turnNumber &&
        card.faction === "rhodes_island",
    );
    return slotIndexes.length
      ? { kind: "retreat", slotIndexes }
      : { kind: "unavailable", reason: "没有可接续撤退的横置罗德岛干员" };
  }
  if (context.effectId === "RM-E001") {
    const sacrificeSlotIndexes = deployedOperatorSlots(
      state,
      content,
      playerId,
      (deployed, card) => deployed.isUpright && card.faction === "reunion",
    );
    const targetSlotIndexes = deployedOperatorSlots(
      state,
      content,
      playerId,
      (_deployed, card) => card.faction === "reunion",
    );
    if (
      !sacrificeSlotIndexes.some((sacrifice) =>
        targetSlotIndexes.some((target) => target !== sacrifice),
      )
    ) {
      return { kind: "unavailable", reason: "需要两名不同的己方整合运动干员" };
    }
    return {
      kind: "sacrifice_and_operator",
      sacrificeSlotIndexes,
      targetPlayerId: playerId,
      targetSlotIndexes,
      targetsMustDiffer: true,
    };
  }
  if (context.effectId === "RI-E008") {
    const slotIndexes = deployedOperatorSlots(
      state,
      content,
      playerId,
      (deployed, card) =>
        deployed.instanceId !== context.sourceInstanceId &&
        deployed.currentLife < card.life,
    );
    return slotIndexes.length
      ? { kind: "operator", playerId, slotIndexes }
      : { kind: "unavailable", reason: "没有另一名受伤的己方干员" };
  }
  if (context.effectId === "RI-E009") {
    const instanceIds = player.redeployZone.flatMap((entry) => {
      const card = getOperatorDefinition(content, state, entry.instanceId);
      return card?.faction === "rhodes_island" ? [entry.instanceId] : [];
    });
    return instanceIds.length
      ? { kind: "redeploy", instanceIds, maximumSelections: 1 }
      : { kind: "unavailable", reason: "再部署候场区为空" };
  }
  if (context.effectId === "RI-E010") {
    const targetPlayerId = otherPlayer(playerId);
    const slotIndexes = deployedOperatorSlots(
      state,
      content,
      targetPlayerId,
      () => true,
    );
    return slotIndexes.length
      ? { kind: "operator", playerId: targetPlayerId, slotIndexes }
      : { kind: "unavailable", reason: "对手没有可选择的干员" };
  }
  if (context.effectId === "RI-E012") {
    const instanceIds = player.hand.filter((instanceId) => {
      const card = getOperatorDefinition(content, state, instanceId);
      return Boolean(
        card && card.faction === "rhodes_island" && card.cost <= 3,
      );
    });
    const deployedCount = player.deploymentSlots.filter(Boolean).length;
    const slotIndexes =
      deployedCount < player.deploymentCapacity
        ? player.deploymentSlots.flatMap((deployed, index) =>
            deployed ? [] : [index],
          )
        : [];
    return instanceIds.length && slotIndexes.length
      ? { kind: "free_deploy", instanceIds, slotIndexes }
      : {
          kind: "unavailable",
          reason: instanceIds.length ? "没有空余部署位" : "手牌中没有费用不高于3的罗德岛干员",
        };
  }
  if (context.effectId === "RM-E009") {
    const sacrificeSlotIndexes = deployedOperatorSlots(
      state,
      content,
      playerId,
      (deployed, card) =>
        deployed.instanceId !== context.sourceInstanceId &&
        deployed.isUpright &&
        card.faction === "reunion",
    );
    const targetPlayerId = otherPlayer(playerId);
    const targetSlotIndexes = deployedOperatorSlots(
      state,
      content,
      targetPlayerId,
      () => true,
    );
    return sacrificeSlotIndexes.length && targetSlotIndexes.length
      ? {
          kind: "sacrifice_and_operator",
          sacrificeSlotIndexes,
          targetPlayerId,
          targetSlotIndexes,
          targetsMustDiffer: false,
        }
      : {
          kind: "unavailable",
          reason: sacrificeSlotIndexes.length
            ? "对手没有可选择的干员"
            : "没有另一名可击溃的竖置整合运动干员",
        };
  }
  const instanceIds = player.redeployZone.flatMap((entry) => {
    const card = getOperatorDefinition(content, state, entry.instanceId);
    return card?.faction === "reunion" && card.cost <= 3
      ? [entry.instanceId]
      : [];
  });
  return instanceIds.length
    ? { kind: "redeploy", instanceIds, maximumSelections: 2 }
    : { kind: "unavailable", reason: "候场区没有费用不高于3的整合运动干员" };
}

function damageOperator(
  state: GameState,
  content: GameContent,
  targetPlayerId: PlayerId,
  slotIndex: number,
  amount: number,
  causePlayerId: PlayerId,
  causeInstanceId: string,
  events: GameEvent[],
  triggerEvents: TriggerEventSnapshot[],
) {
  const deployed = state.players[targetPlayerId].deploymentSlots[slotIndex];
  const card = deployed
    ? getOperatorDefinition(content, state, deployed.instanceId)
    : undefined;
  if (!deployed || !card) return;
  const lost = Math.min(amount, deployed.currentLife);
  deployed.currentLife -= lost;
  events.push({
    kind: "effect_operator_damaged",
    playerId: targetPlayerId,
    message: `「${card.name}」因主动能力失去${lost}格生命。`,
  });
  if (deployed.currentLife > 0) return;
  const instanceId = deployed.instanceId;
  moveDefeatedOperator(content, state, targetPlayerId, slotIndex);
  events.push({
    kind: "operator_defeated",
    playerId: targetPlayerId,
    message: `「${card.name}」被主动能力击溃。`,
  });
  triggerEvents.push({
    kind: "operator_defeated",
    subjectPlayerId: targetPlayerId,
    subjectInstanceId: instanceId,
    subjectDefinitionId: card.id,
    subjectSlotIndex: slotIndex,
    causePlayerId,
    causeInstanceId,
  });
}

export function activateAbility(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  source: ActiveAbilitySource,
  target: ActiveAbilityTarget,
): CommandResult {
  const options = getActiveAbilityOptions(state, content, playerId, source);
  if (options.kind === "unavailable") return fail(state, options.reason);
  const context = getAbilityContext(state, content, playerId, source);
  if (!context) return fail(state, "主动能力数据无效");

  if (
    options.kind === "retreat" &&
    (target.kind !== "retreat" || !options.slotIndexes.includes(target.slotIndex))
  ) return fail(state, "必须选择一名合法的横置干员");
  if (
    options.kind === "operator" &&
    (target.kind !== "operator" ||
      target.playerId !== options.playerId ||
      !options.slotIndexes.includes(target.slotIndex))
  ) return fail(state, "必须选择一名合法目标干员");
  if (
    options.kind === "redeploy" &&
    (target.kind !== "redeploy" ||
      target.instanceIds.length < 1 ||
      target.instanceIds.length > options.maximumSelections ||
      new Set(target.instanceIds).size !== target.instanceIds.length ||
      target.instanceIds.some((instanceId) => !options.instanceIds.includes(instanceId)))
  ) return fail(state, "必须选择合法数量的候场干员");
  if (
    options.kind === "free_deploy" &&
    (target.kind !== "free_deploy" ||
      !options.instanceIds.includes(target.instanceId) ||
      !options.slotIndexes.includes(target.slotIndex))
  ) return fail(state, "必须选择合法的手牌干员和空部署位");
  if (options.kind === "sacrifice_and_operator") {
    if (
      target.kind !== "sacrifice_and_operator" ||
      !options.sacrificeSlotIndexes.includes(target.sacrificeSlotIndex) ||
      target.targetPlayerId !== options.targetPlayerId ||
      !options.targetSlotIndexes.includes(target.targetSlotIndex) ||
      (options.targetsMustDiffer && target.sacrificeSlotIndex === target.targetSlotIndex)
    ) return fail(state, "附加费用与能力目标不合法");
  }

  const next = structuredClone(state);
  const player = next.players[playerId];
  const events: GameEvent[] = [];
  const triggerEvents: TriggerEventSnapshot[] = [];
  const abilityName =
    content.effects.find((effect) => effect.id === context.effectId)?.abilityName ||
    (source.kind === "commander" ? "专属指令" : "技能");

  if (source.kind === "commander") {
    player.commanderIsUpright = false;
    player.availableDp -= 1;
    recordEffectUsage(next, playerId, context.effectId);
  } else {
    const sourceDeployed = player.deploymentSlots[source.slotIndex];
    if (!sourceDeployed) return fail(state, "技能来源已离开部署区");
    sourceDeployed.isUpright = false;
    if (context.effectId === "RI-E010") player.availableDp -= 2;
    if (context.effectId === "RI-E012") player.availableDp -= 1;
  }
  events.push({
    kind: "active_ability_activated",
    playerId,
    message: `${playerLabel(playerId)}发动「${context.sourceCard.name}·${abilityName}」。`,
  });

  if (context.effectId === "RI-E001" && target.kind === "retreat") {
    const deployed = player.deploymentSlots[target.slotIndex]!;
    const card = getOperatorDefinition(content, next, deployed.instanceId)!;
    player.deploymentSlots[target.slotIndex] = null;
    removeAttachedEffects(next, deployed.instanceId);
    player.redeployZone.push({
      instanceId: deployed.instanceId,
      remainingCd: 1,
      source: "retreat",
    });
    const recovered = Math.min(card.retreatRefund, player.maxDp - player.availableDp);
    player.availableDp += recovered;
    events.push({
      kind: "operator_retreated",
      playerId,
      message: `「${card.name}」因指挥官指令主动撤退，实际恢复${recovered} DP。`,
    });
    triggerEvents.push({
      kind: "operator_retreated",
      subjectPlayerId: playerId,
      subjectInstanceId: deployed.instanceId,
      subjectDefinitionId: card.id,
      subjectSlotIndex: target.slotIndex,
      subjectWasDamaged: deployed.currentLife < card.life,
    });
  } else if (
    context.effectId === "RM-E001" &&
    target.kind === "sacrifice_and_operator"
  ) {
    const sacrificed = player.deploymentSlots[target.sacrificeSlotIndex]!;
    const sacrificedCard = getOperatorDefinition(content, next, sacrificed.instanceId)!;
    const buffTarget = player.deploymentSlots[target.targetSlotIndex]!;
    const buffCard = getOperatorDefinition(content, next, buffTarget.instanceId)!;
    moveDefeatedOperator(content, next, playerId, target.sacrificeSlotIndex);
    addOngoingEffect(next, {
      kind: "stat_modifier",
      effectId: context.effectId,
      controllerId: playerId,
      sourceInstanceId: context.sourceInstanceId,
      targetInstanceId: buffTarget.instanceId,
      atkDelta: 2,
      defDelta: 0,
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    events.push({
      kind: "operator_defeated",
      playerId,
      message: `「${sacrificedCard.name}」作为指挥官指令费用被击溃。`,
    }, {
      kind: "commander_order_applied",
      playerId,
      message: `「${buffCard.name}」本回合ATK提高2，且攻击击破干员时额外使其失去1格生命。`,
    });
    triggerEvents.push({
      kind: "operator_defeated",
      subjectPlayerId: playerId,
      subjectInstanceId: sacrificed.instanceId,
      subjectDefinitionId: sacrificedCard.id,
      subjectSlotIndex: target.sacrificeSlotIndex,
      causePlayerId: playerId,
      causeInstanceId: context.sourceInstanceId,
    });
  } else if (context.effectId === "RI-E008" && target.kind === "operator") {
    const deployed = player.deploymentSlots[target.slotIndex]!;
    const stats = getCurrentOperatorStats(
      content,
      next,
      playerId,
      target.slotIndex,
    )!;
    const healed = Math.min(1, stats.maxLife - deployed.currentLife);
    deployed.currentLife += healed;
    const card = getOperatorDefinition(content, next, deployed.instanceId)!;
    events.push({
      kind: "effect_operator_healed",
      playerId,
      message: `「${card.name}」回复${healed}格生命。`,
    });
  } else if (context.effectId === "RI-E009" && target.kind === "redeploy") {
    const instanceId = target.instanceIds[0];
    const entry = player.redeployZone.find((candidate) => candidate.instanceId === instanceId)!;
    entry.remainingCd -= 1;
    const card = getOperatorDefinition(content, next, instanceId)!;
    if (entry.remainingCd === 0) {
      player.redeployZone = player.redeployZone.filter(
        (candidate) => candidate.instanceId !== instanceId,
      );
      player.hand.push(instanceId);
    }
    events.push({
      kind: "redeploy_cd_reduced",
      playerId,
      message: `「${card.name}」的再部署CD减少1${entry.remainingCd === 0 ? "并返回手牌" : ""}。`,
    });
  } else if (context.effectId === "RI-E010" && target.kind === "operator") {
    damageOperator(
      next,
      content,
      target.playerId,
      target.slotIndex,
      1,
      playerId,
      context.sourceInstanceId,
      events,
      triggerEvents,
    );
  } else if (context.effectId === "RI-E012" && target.kind === "free_deploy") {
    const card = getOperatorDefinition(content, next, target.instanceId)!;
    player.hand = player.hand.filter((instanceId) => instanceId !== target.instanceId);
    player.deploymentSlots[target.slotIndex] = {
      instanceId: target.instanceId,
      currentLife: card.life,
      isUpright: true,
      deployedTurn: next.turnNumber,
      atkModifier: 0,
      defModifier: 0,
    };
    const deploymentEvents = consumeNextDeploymentEffects(
      next,
      playerId,
      card,
      target.instanceId,
    );
    consumeDeploymentCostModifiers(next, target.instanceId);
    events.push({
      kind: "operator_deployed",
      playerId,
      message: `「${card.name}」因凯尔希的技能免费部署至位置${target.slotIndex + 1}。`,
    }, ...deploymentEvents);
    triggerEvents.push({
      kind: "operator_deployed",
      subjectPlayerId: playerId,
      subjectInstanceId: target.instanceId,
      subjectDefinitionId: card.id,
      subjectSlotIndex: target.slotIndex,
    });
  } else if (
    context.effectId === "RM-E009" &&
    target.kind === "sacrifice_and_operator"
  ) {
    const sacrificed = player.deploymentSlots[target.sacrificeSlotIndex]!;
    const card = getOperatorDefinition(content, next, sacrificed.instanceId)!;
    moveDefeatedOperator(content, next, playerId, target.sacrificeSlotIndex);
    events.push({
      kind: "operator_defeated",
      playerId,
      message: `「${card.name}」作为技能费用被击溃。`,
    });
    triggerEvents.push({
      kind: "operator_defeated",
      subjectPlayerId: playerId,
      subjectInstanceId: sacrificed.instanceId,
      subjectDefinitionId: card.id,
      subjectSlotIndex: target.sacrificeSlotIndex,
      causePlayerId: playerId,
      causeInstanceId: context.sourceInstanceId,
    });
    damageOperator(
      next,
      content,
      target.targetPlayerId,
      target.targetSlotIndex,
      1,
      playerId,
      context.sourceInstanceId,
      events,
      triggerEvents,
    );
  } else if (context.effectId === "RM-E010" && target.kind === "redeploy") {
    for (const instanceId of target.instanceIds) {
      const entry = player.redeployZone.find(
        (candidate) => candidate.instanceId === instanceId,
      );
      const card = getOperatorDefinition(content, next, instanceId);
      if (!entry || !card) continue;
      entry.remainingCd -= 1;
      if (entry.remainingCd === 0) {
        player.redeployZone = player.redeployZone.filter(
          (candidate) => candidate.instanceId !== instanceId,
        );
        player.hand.push(instanceId);
      }
      events.push({
        kind: "redeploy_cd_reduced",
        playerId,
        message: `「${card.name}」的再部署CD减少1${entry.remainingCd === 0 ? "并返回手牌" : ""}。`,
      });
    }
  }

  return success(next, content, events, triggerEvents);
}
