import type { CardDefinition, GameContent } from "../content";
import { getOngoingStatModifier, removeAttachedEffects } from "./ongoingEffects";
import type { GameState, PlayerId } from "./schema";

export type OperatorDefinition = Extract<
  CardDefinition,
  { type: "operator" }
>;

export function getOperatorDefinition(
  content: GameContent,
  state: GameState,
  instanceId: string,
): OperatorDefinition | undefined {
  const definitionId = state.cardInstances[instanceId]?.definitionId;
  const definition = content.cards.find((card) => card.id === definitionId);
  return definition?.type === "operator" ? definition : undefined;
}

export function getCurrentOperatorStats(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  slotIndex: number,
) {
  const deployed = state.players[playerId].deploymentSlots[slotIndex];
  if (!deployed) return null;
  const card = getOperatorDefinition(content, state, deployed.instanceId);
  if (!card) return null;
  const ongoing = getOngoingStatModifier(state, deployed.instanceId);
  return {
    atk: card.atk + deployed.atkModifier + ongoing.atkDelta,
    def: card.def + deployed.defModifier + ongoing.defDelta,
    maxLife: card.life,
  };
}

export function moveDefeatedOperator(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  slotIndex: number,
) {
  const player = state.players[playerId];
  const deployed = player.deploymentSlots[slotIndex];
  if (!deployed) return null;
  const card = getOperatorDefinition(content, state, deployed.instanceId);
  if (!card) return null;

  player.deploymentSlots[slotIndex] = null;
  removeAttachedEffects(state, deployed.instanceId);
  if (card.redeployCd > 0) {
    player.redeployZone.push({
      instanceId: deployed.instanceId,
      remainingCd: card.redeployCd,
      source: "defeat",
    });
    return { card, destination: "redeploy" as const };
  }
  player.hand.push(deployed.instanceId);
  return { card, destination: "hand" as const };
}
