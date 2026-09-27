import type { GameContent } from "../content";
import { canUseEffect } from "./ongoingEffects";
import type {
  GameEvent,
  GameState,
  PendingTrigger,
  PlayerId,
  TriggerEventSnapshot,
} from "./schema";

type TriggerPattern =
  | "self_deployed"
  | "self_retreated"
  | "self_defeated"
  | "other_friendly_retreated"
  | "other_friendly_defeated"
  | "field_friendly_retreated"
  | "field_friendly_defeated"
  | "attacker_defeated_interceptor";

interface TriggerRule {
  effectId: string;
  cardId: string;
  pattern: TriggerPattern;
  condition?:
    | "friendly_retreated_this_turn"
    | "friendly_defeated_this_turn"
    | "source_ready_not_new_and_unused"
    | "damaged_retreat_on_own_turn_and_unused"
    | "defeat_on_own_turn_and_unused";
  subjectFaction?: "rhodes_island" | "reunion";
}

// Only abilities whose trigger windows are unambiguous are registered here.
// Targeting, optional decisions, costs and durations are deliberately resolved later.
const triggerRules: readonly TriggerRule[] = [
  { effectId: "RI-E002", cardId: "RI-O001", pattern: "self_retreated" },
  {
    effectId: "RI-E004",
    cardId: "RI-O004",
    pattern: "other_friendly_retreated",
    condition: "source_ready_not_new_and_unused",
    subjectFaction: "rhodes_island",
  },
  {
    effectId: "RI-E005",
    cardId: "RI-O005",
    pattern: "self_deployed",
    condition: "friendly_retreated_this_turn",
  },
  {
    effectId: "RI-E006",
    cardId: "RI-O005",
    pattern: "attacker_defeated_interceptor",
  },
  {
    effectId: "RI-E007",
    cardId: "RI-O006",
    pattern: "self_deployed",
    condition: "friendly_retreated_this_turn",
  },
  { effectId: "RI-E011", cardId: "RI-O010", pattern: "self_deployed" },
  { effectId: "RM-E002", cardId: "RM-O001", pattern: "self_defeated" },
  { effectId: "RM-E003", cardId: "RM-O002", pattern: "self_defeated" },
  { effectId: "RM-E005", cardId: "RM-O004", pattern: "self_defeated" },
  {
    effectId: "RM-E006",
    cardId: "RM-O005",
    pattern: "self_deployed",
    condition: "friendly_defeated_this_turn",
  },
  { effectId: "RM-E007", cardId: "RM-O006", pattern: "self_deployed" },
  {
    effectId: "RM-E008",
    cardId: "RM-O006",
    pattern: "other_friendly_defeated",
    subjectFaction: "reunion",
  },
  {
    effectId: "RI-E018",
    cardId: "RI-F001",
    pattern: "field_friendly_retreated",
    condition: "damaged_retreat_on_own_turn_and_unused",
    subjectFaction: "rhodes_island",
  },
  {
    effectId: "RM-E017",
    cardId: "RM-F001",
    pattern: "field_friendly_defeated",
    condition: "defeat_on_own_turn_and_unused",
    subjectFaction: "reunion",
  },
];

interface TriggerSource {
  controllerId: PlayerId;
  definitionId: string;
  instanceId: string;
  slotIndex: number | null;
}

const playerLabel = (playerId: PlayerId) =>
  playerId === "player1" ? "玩家1" : "玩家2";

function findDeployedSources(
  state: GameState,
  playerId: PlayerId,
  definitionId: string,
): TriggerSource[] {
  return state.players[playerId].deploymentSlots.flatMap((deployed, slotIndex) => {
    if (!deployed) return [];
    const instance = state.cardInstances[deployed.instanceId];
    if (instance?.definitionId !== definitionId) return [];
    return [{
      controllerId: playerId,
      definitionId,
      instanceId: deployed.instanceId,
      slotIndex,
    }];
  });
}

function sourceForSelfEvent(
  event: TriggerEventSnapshot,
  definitionId: string,
): TriggerSource[] {
  if (event.subjectDefinitionId !== definitionId) return [];
  return [{
    controllerId: event.subjectPlayerId,
    definitionId,
    instanceId: event.subjectInstanceId,
    slotIndex: event.subjectSlotIndex,
  }];
}

function findFieldSource(
  state: GameState,
  event: TriggerEventSnapshot,
  definitionId: string,
): TriggerSource[] {
  const field = state.sharedField;
  if (!field || field.controllerId !== event.subjectPlayerId) return [];
  const instance = state.cardInstances[field.instanceId];
  if (instance?.definitionId !== definitionId) return [];
  return [{
    controllerId: field.controllerId,
    definitionId,
    instanceId: field.instanceId,
    slotIndex: null,
  }];
}

function matchesCondition(
  state: GameState,
  content: GameContent,
  source: TriggerSource,
  condition: TriggerRule["condition"],
  event: TriggerEventSnapshot,
) {
  if (!condition) return true;
  const facts = state.turnFacts[source.controllerId];
  if (condition === "friendly_retreated_this_turn") {
    return facts.retreatedOperatorIds.some((instanceId) => {
      const definitionId = state.cardInstances[instanceId]?.definitionId;
      return content.cards.find((card) => card.id === definitionId)?.faction ===
        "rhodes_island";
    });
  }
  if (condition === "friendly_defeated_this_turn") {
    return facts.defeatedOperatorIds.some((instanceId) => {
      const definitionId = state.cardInstances[instanceId]?.definitionId;
      return content.cards.find((card) => card.id === definitionId)?.faction ===
        "reunion";
    });
  }
  if (condition === "damaged_retreat_on_own_turn_and_unused") {
    return (
      source.controllerId === state.activePlayer &&
      event.subjectWasDamaged === true &&
      canUseEffect(
        state,
        source.controllerId,
        "RI-E018",
        1,
        source.instanceId,
      )
    );
  }
  if (condition === "defeat_on_own_turn_and_unused") {
    return (
      source.controllerId === state.activePlayer &&
      canUseEffect(
        state,
        source.controllerId,
        "RM-E017",
        1,
        source.instanceId,
      )
    );
  }
  if (!canUseEffect(state, source.controllerId, "RI-E004", 1) || source.slotIndex === null) {
    return false;
  }
  const deployed = state.players[source.controllerId].deploymentSlots[source.slotIndex];
  return Boolean(
    deployed?.isUpright && deployed.deployedTurn !== state.turnNumber,
  );
}

function collectSources(
  state: GameState,
  event: TriggerEventSnapshot,
  rule: TriggerRule,
): TriggerSource[] {
  if (rule.pattern === "self_deployed") {
    return event.kind === "operator_deployed"
      ? sourceForSelfEvent(event, rule.cardId)
      : [];
  }
  if (rule.pattern === "self_retreated") {
    return event.kind === "operator_retreated"
      ? sourceForSelfEvent(event, rule.cardId)
      : [];
  }
  if (rule.pattern === "self_defeated") {
    return event.kind === "operator_defeated"
      ? sourceForSelfEvent(event, rule.cardId)
      : [];
  }
  if (rule.pattern === "other_friendly_retreated") {
    if (event.kind !== "operator_retreated") return [];
    return findDeployedSources(state, event.subjectPlayerId, rule.cardId).filter(
      (source) => source.instanceId !== event.subjectInstanceId,
    );
  }
  if (rule.pattern === "other_friendly_defeated") {
    if (event.kind !== "operator_defeated") return [];
    return findDeployedSources(state, event.subjectPlayerId, rule.cardId).filter(
      (source) => source.instanceId !== event.subjectInstanceId,
    );
  }
  if (rule.pattern === "field_friendly_retreated") {
    return event.kind === "operator_retreated"
      ? findFieldSource(state, event, rule.cardId)
      : [];
  }
  if (rule.pattern === "field_friendly_defeated") {
    return event.kind === "operator_defeated"
      ? findFieldSource(state, event, rule.cardId)
      : [];
  }
  if (
    event.kind !== "operator_defeated" ||
    !event.wasInterceptor ||
    !event.causePlayerId ||
    !event.causeInstanceId
  ) {
    return [];
  }
  const cause = state.cardInstances[event.causeInstanceId];
  if (cause?.definitionId !== rule.cardId) return [];
  const slotIndex = state.players[event.causePlayerId].deploymentSlots.findIndex(
    (deployed) => deployed?.instanceId === event.causeInstanceId,
  );
  return [{
    controllerId: event.causePlayerId,
    definitionId: rule.cardId,
    instanceId: event.causeInstanceId,
    slotIndex: slotIndex < 0 ? null : slotIndex,
  }];
}

function recordTurnFact(state: GameState, event: TriggerEventSnapshot) {
  const facts = state.turnFacts[event.subjectPlayerId];
  const destination =
    event.kind === "operator_retreated"
      ? facts.retreatedOperatorIds
      : event.kind === "operator_defeated"
        ? facts.defeatedOperatorIds
        : null;
  if (destination && !destination.includes(event.subjectInstanceId)) {
    destination.push(event.subjectInstanceId);
  }
}

export function enqueueTriggerEvent(
  state: GameState,
  content: GameContent,
  event: TriggerEventSnapshot,
): GameEvent[] {
  recordTurnFact(state, event);

  const candidates = triggerRules.flatMap((rule) => {
    const effect = content.effects.find((candidate) => candidate.id === rule.effectId);
    if (!effect) return [];
    const subject = content.cards.find(
      (candidate) => candidate.id === event.subjectDefinitionId,
    );
    if (rule.subjectFaction && subject?.faction !== rule.subjectFaction) return [];
    return collectSources(state, event, rule)
      .filter((source) => matchesCondition(state, content, source, rule.condition, event))
      .map((source) => ({ rule, effect, source }));
  });

  if (candidates.length === 0) return [];

  candidates.sort((left, right) => {
    const leftPriority = left.source.controllerId === state.activePlayer ? 0 : 1;
    const rightPriority = right.source.controllerId === state.activePlayer ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    const leftSlot = left.source.slotIndex ?? 99;
    const rightSlot = right.source.slotIndex ?? 99;
    if (leftSlot !== rightSlot) return leftSlot - rightSlot;
    const instanceOrder = left.source.instanceId.localeCompare(right.source.instanceId);
    return instanceOrder || left.rule.effectId.localeCompare(right.rule.effectId);
  });

  const batchId = state.nextTriggerBatchId;
  state.nextTriggerBatchId += 1;
  const queued = candidates.map<PendingTrigger>(({ rule, effect, source }) => ({
    id: state.nextTriggerId++,
    batchId,
    effectId: rule.effectId,
    sourceDefinitionId: source.definitionId,
    sourceInstanceId: source.instanceId,
    sourceSlotIndex: source.slotIndex,
    controllerId: source.controllerId,
    priority:
      source.controllerId === state.activePlayer
        ? "active_player"
        : "non_active_player",
    optional: effect.text.includes("可以"),
    stage: "decision",
    event,
  }));
  if (state.triggerQueue.length === 0) {
    state.triggerResumeViewer = state.currentViewer;
  }
  state.triggerQueue.push(...queued);

  return [{
    kind: "triggers_queued",
    message: `触发批次 #${batchId} 已入队，共${queued.length}项；${playerLabel(state.activePlayer)}控制的能力优先。`,
  }];
}

export function getNextPendingTrigger(state: GameState) {
  return state.triggerQueue[0] ?? null;
}
