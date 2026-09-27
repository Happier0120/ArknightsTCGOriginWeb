export {
  applyGameCommand,
  createGame,
  getCardDefinitionId,
  getDeploymentCost,
  getFieldPlayOptions,
  getLegalAttackTargets,
  getLegalInterceptors,
  getLegalTacticalSupportTargets,
  getTacticalSupportPlayOptions,
} from "./engine";
export {
  effectInstructionSchema,
  executeEffectInstructions,
} from "./effects";
export { getCurrentOperatorStats } from "./operators";
export {
  canUseEffect,
  getEffectUsageCount,
  getDeploymentCostModifier,
  getOngoingStatModifier,
  hasAttackPermission,
  hasGrantedKeyword,
} from "./ongoingEffects";
export { enqueueTriggerEvent, getNextPendingTrigger } from "./triggers";
export { getActiveAbilityOptions } from "./activeAbilities";
export { getLegalTriggerTargets } from "./triggerResolution";
export {
  clearGameSnapshot,
  GAME_SNAPSHOT_KEY,
  loadGameSnapshot,
  saveGameSnapshot,
} from "./persistence";
export { gameCommandSchema } from "./schema";
export type {
  CommandResult,
  AttackTarget,
  ActiveAbilitySource,
  ActiveAbilityTarget,
  CreateGameConfig,
  GameCommand,
  GameEvent,
  GameState,
  Phase,
  PlayerId,
  PlayerState,
  PendingAttack,
  PendingTrigger,
  OngoingEffect,
  PendingTacticalSupport,
  SharedField,
  TacticalSupportTarget,
  TriggerEventKind,
  TriggerEventSnapshot,
  TriggerTarget,
} from "./schema";
export type { ActiveAbilityOptions } from "./activeAbilities";
export type { TacticalSupportPlayOptions } from "./engine";
export type { FieldPlayOptions } from "./engine";
export type {
  EffectExecutionResult,
  EffectInstruction,
  EffectStepResult,
} from "./effects";
