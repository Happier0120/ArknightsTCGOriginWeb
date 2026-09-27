import { z } from "zod";
import type { GameContent } from "../content";
import {
  getCurrentOperatorStats,
  getOperatorDefinition,
  moveDefeatedOperator,
} from "./operators";
import {
  playerIdSchema,
  type GameEvent,
  type GameState,
  type PlayerId,
  type TriggerEventSnapshot,
} from "./schema";
import { enqueueTriggerEvent } from "./triggers";

const playerEffectSchema = z.object({
  playerId: playerIdSchema,
  amount: z.number().int().positive(),
});

const operatorEffectSchema = z.object({
  playerId: playerIdSchema,
  slotIndex: z.number().int().min(0).max(6),
  amount: z.number().int().positive(),
});

export const effectInstructionSchema = z.discriminatedUnion("type", [
  playerEffectSchema.extend({ type: z.literal("draw_cards") }),
  playerEffectSchema.extend({ type: z.literal("recover_dp") }),
  playerEffectSchema.extend({ type: z.literal("increase_max_dp") }),
  playerEffectSchema.extend({ type: z.literal("lose_shields") }),
  operatorEffectSchema.extend({ type: z.literal("damage_operator") }),
  operatorEffectSchema.extend({ type: z.literal("heal_operator") }),
  z
    .object({
      type: z.literal("modify_operator_stats"),
      playerId: playerIdSchema,
      slotIndex: z.number().int().min(0).max(6),
      atkDelta: z.number().int(),
      defDelta: z.number().int(),
    })
    .refine((instruction) => instruction.atkDelta !== 0 || instruction.defDelta !== 0, {
      message: "属性修正至少需要改变一项数值",
    }),
]);

export type EffectInstruction = z.infer<typeof effectInstructionSchema>;

export interface EffectStepResult {
  index: number;
  type: EffectInstruction["type"];
  applied: boolean;
  actualAmount?: number;
  reason?: string;
}

export type EffectExecutionResult =
  | {
      ok: true;
      state: GameState;
      events: GameEvent[];
      steps: EffectStepResult[];
    }
  | {
      ok: false;
      state: GameState;
      error: string;
      events: [];
      steps: [];
    };

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

const playerLabel = (playerId: PlayerId) =>
  playerId === "player1" ? "玩家1" : "玩家2";

function appendEvents(state: GameState, events: GameEvent[]) {
  for (const event of events) {
    state.log.push({ id: state.log.length + 1, ...event });
  }
}

function finishForDeckOut(state: GameState, playerId: PlayerId) {
  state.status = "finished";
  state.phase = "finished";
  state.winner = otherPlayer(playerId);
  state.finishReason = "deck_out";
  state.handoff = null;
  state.pendingAttack = null;
}

function finishForShields(state: GameState, playerId: PlayerId) {
  state.status = "finished";
  state.phase = "finished";
  state.winner = otherPlayer(playerId);
  state.finishReason = "shields_depleted";
  state.handoff = null;
  state.pendingAttack = null;
}

export function executeEffectInstructions(
  state: GameState,
  instructions: readonly EffectInstruction[],
  content: GameContent,
): EffectExecutionResult {
  const parsed = z.array(effectInstructionSchema).safeParse(instructions);
  if (!parsed.success) {
    return {
      ok: false,
      state,
      error: parsed.error.issues[0]?.message ?? "效果指令无效",
      events: [],
      steps: [],
    };
  }
  if (state.status === "finished") {
    return {
      ok: false,
      state,
      error: "对局已经结束，不能继续结算效果",
      events: [],
      steps: [],
    };
  }

  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const triggerEvents: TriggerEventSnapshot[] = [];
  const steps: EffectStepResult[] = [];

  for (const [index, instruction] of parsed.data.entries()) {
    const player = next.players[instruction.playerId];

    if (instruction.type === "draw_cards") {
      let drawn = 0;
      while (drawn < instruction.amount) {
        const instanceId = player.drawPile.shift();
        if (!instanceId) {
          if (drawn > 0) {
            events.push({
              kind: "effect_cards_drawn",
              playerId: instruction.playerId,
              message: `${playerLabel(instruction.playerId)}因效果抽取${drawn}张牌。`,
            });
          }
          finishForDeckOut(next, instruction.playerId);
          events.push({
            kind: "game_finished",
            playerId: instruction.playerId,
            message: `${playerLabel(instruction.playerId)}因效果必须抽牌但牌库为空，对局结束。`,
          });
          steps.push({
            index,
            type: instruction.type,
            applied: true,
            actualAmount: drawn,
          });
          break;
        }
        player.hand.push(instanceId);
        drawn += 1;
      }
      if (next.status !== "finished") {
        events.push({
          kind: "effect_cards_drawn",
          playerId: instruction.playerId,
          message: `${playerLabel(instruction.playerId)}因效果抽取${drawn}张牌。`,
        });
        steps.push({ index, type: instruction.type, applied: true, actualAmount: drawn });
      }
    } else if (instruction.type === "recover_dp") {
      const recovered = Math.min(
        instruction.amount,
        player.maxDp - player.availableDp,
      );
      if (recovered === 0) {
        steps.push({
          index,
          type: instruction.type,
          applied: false,
          reason: "可用DP已经达到上限",
        });
      } else {
        player.availableDp += recovered;
        events.push({
          kind: "effect_dp_recovered",
          playerId: instruction.playerId,
          message: `${playerLabel(instruction.playerId)}因效果恢复${recovered} DP。`,
        });
        steps.push({ index, type: instruction.type, applied: true, actualAmount: recovered });
      }
    } else if (instruction.type === "increase_max_dp") {
      player.maxDp += instruction.amount;
      player.availableDp += instruction.amount;
      events.push({
        kind: "effect_max_dp_increased",
        playerId: instruction.playerId,
        message: `${playerLabel(instruction.playerId)}的DP上限提高${instruction.amount}，新加入的DP保持可用。`,
      });
      steps.push({
        index,
        type: instruction.type,
        applied: true,
        actualAmount: instruction.amount,
      });
    } else if (instruction.type === "lose_shields") {
      const lost = Math.min(instruction.amount, player.shields);
      if (lost === 0) {
        steps.push({
          index,
          type: instruction.type,
          applied: false,
          reason: "没有可失去的理智盾",
        });
      } else {
        player.shields -= lost;
        events.push({
          kind: "effect_shields_lost",
          playerId: instruction.playerId,
          message: `${playerLabel(instruction.playerId)}因效果失去${lost}个理智盾，剩余${player.shields}个。`,
        });
        steps.push({ index, type: instruction.type, applied: true, actualAmount: lost });
        if (player.shields === 0) {
          finishForShields(next, instruction.playerId);
          events.push({
            kind: "game_finished",
            message: `${playerLabel(otherPlayer(instruction.playerId))}因对手失去最后一个理智盾而获胜。`,
          });
        }
      }
    } else {
      const deployed = player.deploymentSlots[instruction.slotIndex];
      const card = deployed
        ? getOperatorDefinition(content, next, deployed.instanceId)
        : undefined;
      if (!deployed || !card) {
        steps.push({
          index,
          type: instruction.type,
          applied: false,
          reason: "目标部署位没有有效干员",
        });
      } else if (instruction.type === "damage_operator") {
        const lost = Math.min(instruction.amount, deployed.currentLife);
        deployed.currentLife -= lost;
        events.push({
          kind: "effect_operator_damaged",
          playerId: instruction.playerId,
          message: `「${card.name}」因效果失去${lost}格生命。`,
        });
        steps.push({ index, type: instruction.type, applied: true, actualAmount: lost });
        if (deployed.currentLife === 0) {
          const defeatedInstanceId = deployed.instanceId;
          const defeat = moveDefeatedOperator(
            content,
            next,
            instruction.playerId,
            instruction.slotIndex,
          );
          if (defeat) {
            events.push({
              kind: "operator_defeated",
              playerId: instruction.playerId,
              message:
                defeat.destination === "redeploy"
                  ? `「${card.name}」被效果击溃，进入再部署候场区（CD ${card.redeployCd}）。`
                  : `「${card.name}」被效果击溃并返回手牌。`,
            });
            triggerEvents.push({
              kind: "operator_defeated",
              subjectPlayerId: instruction.playerId,
              subjectInstanceId: defeatedInstanceId,
              subjectDefinitionId: card.id,
              subjectSlotIndex: instruction.slotIndex,
            });
          }
        }
      } else if (instruction.type === "heal_operator") {
        const stats = getCurrentOperatorStats(
          content,
          next,
          instruction.playerId,
          instruction.slotIndex,
        );
        const healed = stats
          ? Math.min(instruction.amount, stats.maxLife - deployed.currentLife)
          : 0;
        if (healed === 0) {
          steps.push({
            index,
            type: instruction.type,
            applied: false,
            reason: "目标生命已满",
          });
        } else {
          deployed.currentLife += healed;
          events.push({
            kind: "effect_operator_healed",
            playerId: instruction.playerId,
            message: `「${card.name}」因效果回复${healed}格生命。`,
          });
          steps.push({ index, type: instruction.type, applied: true, actualAmount: healed });
        }
      } else {
        deployed.atkModifier += instruction.atkDelta;
        deployed.defModifier += instruction.defDelta;
        events.push({
          kind: "effect_operator_stats_modified",
          playerId: instruction.playerId,
          message: `「${card.name}」获得属性修正：ATK ${instruction.atkDelta >= 0 ? "+" : ""}${instruction.atkDelta}，DEF ${instruction.defDelta >= 0 ? "+" : ""}${instruction.defDelta}。`,
        });
        steps.push({ index, type: instruction.type, applied: true });
      }
    }

    if (next.status === "finished") break;
  }

  appendEvents(next, events);
  const queueEvents = triggerEvents.flatMap((event) =>
    enqueueTriggerEvent(next, content, event),
  );
  appendEvents(next, queueEvents);
  return { ok: true, state: next, events: [...events, ...queueEvents], steps };
}
