import { z } from "zod";

export const playerIdSchema = z.enum(["player1", "player2"]);
export const phaseSchema = z.enum([
  "setup",
  "ready",
  "draw",
  "main",
  "end",
  "finished",
]);
export const gameStatusSchema = z.enum([
  "mulligan",
  "handoff",
  "playing",
  "defending",
  "finished",
]);

const cardInstanceSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  owner: playerIdSchema,
});

const deployedOperatorSchema = z.object({
  instanceId: z.string().min(1),
  currentLife: z.number().int().positive(),
  isUpright: z.boolean(),
  deployedTurn: z.number().int().positive(),
  atkModifier: z.number().int(),
  defModifier: z.number().int(),
});

const redeployEntrySchema = z.object({
  instanceId: z.string().min(1),
  remainingCd: z.number().int().positive(),
  source: z.enum(["retreat", "defeat"]),
});

const playerStateSchema = z.object({
  id: playerIdSchema,
  deckId: z.string().min(1),
  commanderId: z.string().min(1),
  commanderIsUpright: z.boolean(),
  drawPile: z.array(z.string()),
  hand: z.array(z.string()),
  discardPile: z.array(z.string()),
  deploymentSlots: z.array(deployedOperatorSchema.nullable()).length(7),
  deploymentCapacity: z.number().int().positive().max(7),
  redeployZone: z.array(redeployEntrySchema),
  shields: z.number().int().nonnegative(),
  maxDp: z.number().int().nonnegative(),
  availableDp: z.number().int().nonnegative(),
  mulliganCompleted: z.boolean(),
  turnsStarted: z.number().int().nonnegative(),
});

const handoffSchema = z.object({
  nextPlayer: playerIdSchema,
  resume: z.enum(["mulligan", "start_turn", "defend_attack", "resume_main"]),
});

const attackTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shield") }),
  z.object({
    kind: z.literal("operator"),
    slotIndex: z.number().int().min(0).max(6),
  }),
]);

const pendingAttackSchema = z.object({
  attackerPlayerId: playerIdSchema,
  attackerSlotIndex: z.number().int().min(0).max(6),
  defenderPlayerId: playerIdSchema,
  target: attackTargetSchema,
});

const logEntrySchema = z.object({
  id: z.number().int().positive(),
  kind: z.string().min(1),
  message: z.string().min(1),
  playerId: playerIdSchema.optional(),
});

export const triggerEventKindSchema = z.enum([
  "operator_deployed",
  "operator_retreated",
  "operator_defeated",
]);

export const triggerEventSnapshotSchema = z.object({
  kind: triggerEventKindSchema,
  subjectPlayerId: playerIdSchema,
  subjectInstanceId: z.string().min(1),
  subjectDefinitionId: z.string().min(1),
  subjectSlotIndex: z.number().int().min(0).max(6),
  causePlayerId: playerIdSchema.optional(),
  causeInstanceId: z.string().min(1).optional(),
  wasInterceptor: z.boolean().optional(),
  subjectWasDamaged: z.boolean().optional(),
});

export const pendingTriggerSchema = z.object({
  id: z.number().int().positive(),
  batchId: z.number().int().positive(),
  effectId: z.string().min(1),
  sourceDefinitionId: z.string().min(1),
  sourceInstanceId: z.string().min(1),
  sourceSlotIndex: z.number().int().min(0).max(6).nullable(),
  controllerId: playerIdSchema,
  priority: z.enum(["active_player", "non_active_player"]),
  optional: z.boolean(),
  stage: z.enum(["decision", "discard_after_draw"]),
  event: triggerEventSnapshotSchema,
});

const effectExpirySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("turn_end"),
    turnNumber: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("ready_start"),
    playerId: playerIdSchema,
  }),
]);

export const ongoingEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("next_deployment"),
    effectId: z.string().min(1),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    createdTurn: z.number().int().positive(),
    payload: z.enum(["grant_intercept", "allow_attack_on_deploy_turn"]),
    requiredFaction: z.enum(["rhodes_island", "reunion"]).optional(),
    requiredPosition: z.enum(["ground", "high_ground"]).optional(),
    expires: effectExpirySchema,
  }),
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("granted_keyword"),
    effectId: z.string().min(1),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    targetInstanceId: z.string().min(1),
    keyword: z.literal("intercept"),
    expires: effectExpirySchema,
  }),
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("attack_permission"),
    effectId: z.string().min(1),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    targetInstanceId: z.string().min(1),
    permission: z.literal("ignore_deployment_turn"),
    expires: effectExpirySchema,
  }),
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("stat_modifier"),
    effectId: z.string().min(1),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    targetInstanceId: z.string().min(1),
    atkDelta: z.number().int(),
    defDelta: z.number().int(),
    expires: effectExpirySchema,
  }),
  z.object({
    id: z.number().int().positive(),
    kind: z.literal("deployment_cost_modifier"),
    effectId: z.string().min(1),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    targetInstanceId: z.string().min(1),
    amount: z.number().int().negative(),
    expires: effectExpirySchema,
  }),
]);

const effectUsageSchema = z.object({
  effectId: z.string().min(1),
  controllerId: playerIdSchema,
  sourceInstanceId: z.string().min(1).optional(),
  turnNumber: z.number().int().positive(),
  count: z.number().int().positive(),
});

const sharedFieldSchema = z.object({
  instanceId: z.string().min(1),
  controllerId: playerIdSchema,
});

const playerTurnFactsSchema = z.object({
  retreatedOperatorIds: z.array(z.string()),
  defeatedOperatorIds: z.array(z.string()),
});

export const triggerTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("operator"),
    playerId: playerIdSchema,
    slotIndex: z.number().int().min(0).max(6),
  }),
  z.object({
    kind: z.literal("redeploy"),
    playerId: playerIdSchema,
    instanceId: z.string().min(1),
  }),
]);

const tacticalSupportTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator"), slotIndex: z.number().int().min(0).max(6) }),
  z.object({ kind: z.literal("redeploy"), instanceId: z.string().min(1) }),
  z.object({ kind: z.literal("sacrifice"), slotIndex: z.number().int().min(0).max(6) }),
  z.object({ kind: z.literal("discard_support"), instanceId: z.string().min(1) }),
]);

const activeAbilitySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commander") }),
  z.object({ kind: z.literal("operator"), slotIndex: z.number().int().min(0).max(6) }),
]);

const activeAbilityTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("operator"),
    playerId: playerIdSchema,
    slotIndex: z.number().int().min(0).max(6),
  }),
  z.object({ kind: z.literal("redeploy"), instanceIds: z.array(z.string().min(1)) }),
  z.object({ kind: z.literal("retreat"), slotIndex: z.number().int().min(0).max(6) }),
  z.object({
    kind: z.literal("free_deploy"),
    instanceId: z.string().min(1),
    slotIndex: z.number().int().min(0).max(6),
  }),
  z.object({
    kind: z.literal("sacrifice_and_operator"),
    sacrificeSlotIndex: z.number().int().min(0).max(6),
    targetPlayerId: playerIdSchema,
    targetSlotIndex: z.number().int().min(0).max(6),
  }),
]);

const tacticalSupportResolutionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CHOOSE_SEARCH_RESULT"),
    instanceId: z.string().min(1).nullable(),
  }),
  z.object({
    type: z.literal("ORDER_SEARCH_REMAINDER"),
    instanceIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal("DISCARD_HAND_CARD"),
    instanceId: z.string().min(1),
  }),
]);

export const gameCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SUBMIT_MULLIGAN"),
    playerId: playerIdSchema,
    cardInstanceIds: z.array(z.string().min(1)).max(2),
  }),
  z.object({ type: z.literal("CONFIRM_HANDOFF"), playerId: playerIdSchema }),
  z.object({ type: z.literal("ADVANCE_PHASE"), playerId: playerIdSchema }),
  z.object({
    type: z.literal("DEPLOY_OPERATOR"),
    playerId: playerIdSchema,
    cardInstanceId: z.string().min(1),
    slotIndex: z.number().int().min(0).max(6),
  }),
  z.object({
    type: z.literal("RETREAT_OPERATOR"),
    playerId: playerIdSchema,
    slotIndex: z.number().int().min(0).max(6),
  }),
  z.object({
    type: z.literal("PLAY_TACTICAL_SUPPORT"),
    playerId: playerIdSchema,
    cardInstanceId: z.string().min(1),
    target: tacticalSupportTargetSchema.optional(),
  }),
  z.object({
    type: z.literal("RESOLVE_TACTICAL_SUPPORT"),
    playerId: playerIdSchema,
    action: tacticalSupportResolutionActionSchema,
  }),
  z.object({
    type: z.literal("ACTIVATE_ABILITY"),
    playerId: playerIdSchema,
    source: activeAbilitySourceSchema,
    target: activeAbilityTargetSchema,
  }),
  z.object({
    type: z.literal("PLAY_FIELD"),
    playerId: playerIdSchema,
    cardInstanceId: z.string().min(1),
  }),
  z.object({
    type: z.literal("DECLARE_ATTACK"),
    playerId: playerIdSchema,
    attackerSlotIndex: z.number().int().min(0).max(6),
    target: attackTargetSchema,
  }),
  z.object({
    type: z.literal("RESOLVE_ATTACK"),
    playerId: playerIdSchema,
    interceptSlotIndex: z.number().int().min(0).max(6).nullable(),
  }),
  z.object({
    type: z.literal("CONFIRM_TRIGGER_HANDOFF"),
    playerId: playerIdSchema,
  }),
  z.object({
    type: z.literal("RESOLVE_TRIGGER"),
    playerId: playerIdSchema,
    triggerId: z.number().int().positive(),
    action: z.enum(["activate", "skip"]),
    target: triggerTargetSchema.optional(),
    discardInstanceId: z.string().min(1).optional(),
  }),
]);

const pendingTacticalSupportSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deck_search_choice"),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    effectId: z.string().min(1),
    revealedInstanceIds: z.array(z.string()).max(4),
    maximumOperatorCost: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("deck_search_order"),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    effectId: z.string().min(1),
    remainingInstanceIds: z.array(z.string()).max(4),
  }),
  z.object({
    kind: z.literal("discard_after_draw"),
    controllerId: playerIdSchema,
    sourceInstanceId: z.string().min(1),
    effectId: z.string().min(1),
  }),
]);

const turnFactsSchema = z.object({
  turnNumber: z.number().int().nonnegative(),
  player1: playerTurnFactsSchema,
  player2: playerTurnFactsSchema,
});

export const gameStateSchema = z.object({
  schemaVersion: z.literal(10),
  gameId: z.string().min(1),
  seed: z.string().min(1),
  rngState: z.number().int().nonnegative(),
  status: gameStatusSchema,
  phase: phaseSchema,
  turnNumber: z.number().int().nonnegative(),
  firstPlayer: playerIdSchema,
  activePlayer: playerIdSchema,
  currentViewer: playerIdSchema,
  players: z.object({
    player1: playerStateSchema,
    player2: playerStateSchema,
  }),
  cardInstances: z.record(z.string(), cardInstanceSchema),
  handoff: handoffSchema.nullable(),
  pendingAttack: pendingAttackSchema.nullable(),
  triggerQueue: z.array(pendingTriggerSchema),
  nextTriggerId: z.number().int().positive(),
  nextTriggerBatchId: z.number().int().positive(),
  triggerResumeViewer: playerIdSchema.nullable(),
  pendingTacticalSupport: pendingTacticalSupportSchema.nullable(),
  sharedField: sharedFieldSchema.nullable(),
  ongoingEffects: z.array(ongoingEffectSchema),
  nextOngoingEffectId: z.number().int().positive(),
  effectUsages: z.array(effectUsageSchema),
  turnFacts: turnFactsSchema,
  winner: playerIdSchema.nullable(),
  finishReason: z.enum([
    "deck_out",
    "shields_depleted",
    "concede",
    "opponent_left",
  ]).nullable(),
  log: z.array(logEntrySchema),
});

export type PlayerId = z.infer<typeof playerIdSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type GameStatus = z.infer<typeof gameStatusSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type PlayerState = GameState["players"][PlayerId];
export type GameLogEntry = GameState["log"][number];
export type AttackTarget = z.infer<typeof attackTargetSchema>;
export type PendingAttack = z.infer<typeof pendingAttackSchema>;
export type TriggerEventKind = z.infer<typeof triggerEventKindSchema>;
export type TriggerEventSnapshot = z.infer<typeof triggerEventSnapshotSchema>;
export type PendingTrigger = z.infer<typeof pendingTriggerSchema>;
export type TriggerTarget = z.infer<typeof triggerTargetSchema>;
export type PendingTacticalSupport = z.infer<typeof pendingTacticalSupportSchema>;
export type SharedField = z.infer<typeof sharedFieldSchema>;
export type OngoingEffect = z.infer<typeof ongoingEffectSchema>;

export type TacticalSupportTarget = z.infer<typeof tacticalSupportTargetSchema>;
export type ActiveAbilitySource = z.infer<typeof activeAbilitySourceSchema>;
export type ActiveAbilityTarget = z.infer<typeof activeAbilityTargetSchema>;

export interface CreateGameConfig {
  player1DeckId: string;
  player2DeckId: string;
  firstPlayer: PlayerId;
  seed: string;
}

export type GameCommand = z.infer<typeof gameCommandSchema>;

export type GameEvent = {
  kind: string;
  message: string;
  playerId?: PlayerId;
};

export type CommandResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; state: GameState; error: string; events: [] };
