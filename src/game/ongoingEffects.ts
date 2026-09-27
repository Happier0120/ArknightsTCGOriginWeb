import type { OperatorDefinition } from "./operators";
import type {
  GameEvent,
  GameState,
  OngoingEffect,
  PlayerId,
} from "./schema";

type EffectExpiry = OngoingEffect["expires"];
type NewOngoingEffect = OngoingEffect extends infer Effect
  ? Effect extends OngoingEffect
    ? Omit<Effect, "id">
    : never
  : never;

const playerLabel = (playerId: PlayerId) =>
  playerId === "player1" ? "玩家1" : "玩家2";

export function hasGrantedKeyword(
  state: GameState,
  targetInstanceId: string,
  keyword: "intercept",
) {
  return state.ongoingEffects.some(
    (effect) =>
      effect.kind === "granted_keyword" &&
      effect.targetInstanceId === targetInstanceId &&
      effect.keyword === keyword,
  );
}

export function hasAttackPermission(
  state: GameState,
  targetInstanceId: string,
  permission: "ignore_deployment_turn",
) {
  return state.ongoingEffects.some(
    (effect) =>
      effect.kind === "attack_permission" &&
      effect.targetInstanceId === targetInstanceId &&
      effect.permission === permission,
  );
}

export function getOngoingStatModifier(
  state: GameState,
  targetInstanceId: string,
) {
  return state.ongoingEffects.reduce(
    (total, effect) => {
      if (
        effect.kind === "stat_modifier" &&
        effect.targetInstanceId === targetInstanceId
      ) {
        total.atkDelta += effect.atkDelta;
        total.defDelta += effect.defDelta;
      }
      return total;
    },
    { atkDelta: 0, defDelta: 0 },
  );
}

export function getDeploymentCostModifier(
  state: GameState,
  targetInstanceId: string,
) {
  return state.ongoingEffects.reduce(
    (total, effect) =>
      effect.kind === "deployment_cost_modifier" &&
      effect.targetInstanceId === targetInstanceId
        ? total + effect.amount
        : total,
    0,
  );
}

export function consumeDeploymentCostModifiers(
  state: GameState,
  targetInstanceId: string,
) {
  const before = state.ongoingEffects.length;
  state.ongoingEffects = state.ongoingEffects.filter(
    (effect) =>
      !(
        effect.kind === "deployment_cost_modifier" &&
        effect.targetInstanceId === targetInstanceId
      ),
  );
  return before - state.ongoingEffects.length;
}

export function addOngoingEffect(
  state: GameState,
  effect: NewOngoingEffect,
) {
  state.ongoingEffects.push({ ...effect, id: state.nextOngoingEffectId++ } as OngoingEffect);
}

export function consumeNextDeploymentEffects(
  state: GameState,
  controllerId: PlayerId,
  operator: OperatorDefinition,
  targetInstanceId: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  const remaining: OngoingEffect[] = [];

  for (const effect of state.ongoingEffects) {
    if (
      effect.kind !== "next_deployment" ||
      effect.controllerId !== controllerId ||
      (effect.requiredFaction && effect.requiredFaction !== operator.faction) ||
      (effect.requiredPosition && effect.requiredPosition !== operator.position)
    ) {
      remaining.push(effect);
      continue;
    }

    if (effect.payload === "grant_intercept") {
      remaining.push({
        id: state.nextOngoingEffectId++,
        kind: "granted_keyword",
        effectId: effect.effectId,
        controllerId,
        sourceInstanceId: effect.sourceInstanceId,
        targetInstanceId,
        keyword: "intercept",
        expires: { kind: "ready_start", playerId: controllerId },
      });
      events.push({
        kind: "delayed_effect_applied",
        playerId: controllerId,
        message: `「${operator.name}」获得【拦截】，直到${playerLabel(controllerId)}的下个准备阶段开始。`,
      });
    } else {
      remaining.push({
        id: state.nextOngoingEffectId++,
        kind: "attack_permission",
        effectId: effect.effectId,
        controllerId,
        sourceInstanceId: effect.sourceInstanceId,
        targetInstanceId,
        permission: "ignore_deployment_turn",
        expires: { kind: "turn_end", turnNumber: state.turnNumber },
      });
      events.push({
        kind: "delayed_effect_applied",
        playerId: controllerId,
        message: `「${operator.name}」本回合可以在部署的回合攻击。`,
      });
    }
  }

  state.ongoingEffects = remaining;
  return events;
}

function expiryMatches(effect: OngoingEffect, expiry: EffectExpiry) {
  if (effect.expires.kind !== expiry.kind) return false;
  return expiry.kind === "turn_end"
    ? effect.expires.kind === "turn_end" &&
        effect.expires.turnNumber === expiry.turnNumber
    : effect.expires.kind === "ready_start" &&
        effect.expires.playerId === expiry.playerId;
}

export function expireOngoingEffects(
  state: GameState,
  expiry: EffectExpiry,
) {
  const expired = state.ongoingEffects.filter((effect) => expiryMatches(effect, expiry));
  state.ongoingEffects = state.ongoingEffects.filter(
    (effect) => !expiryMatches(effect, expiry),
  );
  return expired;
}

export function removeAttachedEffects(
  state: GameState,
  targetInstanceId: string,
) {
  const before = state.ongoingEffects.length;
  state.ongoingEffects = state.ongoingEffects.filter(
    (effect) =>
      !("targetInstanceId" in effect && effect.targetInstanceId === targetInstanceId),
  );
  return before - state.ongoingEffects.length;
}

export function getEffectUsageCount(
  state: GameState,
  controllerId: PlayerId,
  effectId: string,
  turnNumber = state.turnNumber,
  sourceInstanceId?: string,
) {
  return state.effectUsages.find(
    (usage) =>
      usage.controllerId === controllerId &&
      usage.effectId === effectId &&
      usage.turnNumber === turnNumber &&
      usage.sourceInstanceId === sourceInstanceId,
  )?.count ?? 0;
}

export function canUseEffect(
  state: GameState,
  controllerId: PlayerId,
  effectId: string,
  limit: number,
  sourceInstanceId?: string,
) {
  return getEffectUsageCount(
    state,
    controllerId,
    effectId,
    state.turnNumber,
    sourceInstanceId,
  ) < limit;
}

export function recordEffectUsage(
  state: GameState,
  controllerId: PlayerId,
  effectId: string,
  sourceInstanceId?: string,
) {
  const usage = state.effectUsages.find(
    (candidate) =>
      candidate.controllerId === controllerId &&
      candidate.effectId === effectId &&
      candidate.sourceInstanceId === sourceInstanceId &&
      candidate.turnNumber === state.turnNumber,
  );
  if (usage) usage.count += 1;
  else {
    state.effectUsages.push({
      controllerId,
      effectId,
      sourceInstanceId,
      turnNumber: state.turnNumber,
      count: 1,
    });
  }
}
