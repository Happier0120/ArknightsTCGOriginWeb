import type { CardDefinition, GameContent } from "../../content";
import type { GameState, Phase, PlayerId } from "../../game";

export const playerLabels: Record<PlayerId, string> = {
  player1: "玩家1",
  player2: "玩家2",
};

export const phaseLabels: Record<Phase, string> = {
  setup: "交接",
  ready: "准备阶段",
  draw: "抽牌阶段",
  main: "主要阶段",
  end: "结束阶段",
  finished: "对局结束",
};

export function getCard(
  content: GameContent,
  state: GameState,
  instanceId: string,
): CardDefinition {
  const definitionId = state.cardInstances[instanceId]?.definitionId;
  const card = content.cards.find((candidate) => candidate.id === definitionId);
  if (!card) throw new Error(`找不到卡牌实例 ${instanceId} 的定义`);
  return card;
}

export function cardSummary(card: CardDefinition) {
  if (card.type === "operator") {
    return `${card.cost} DP · ${card.position === "ground" ? "地面" : "高台"} · ${card.atk}/${card.def}/${card.life}`;
  }
  if (card.type === "commander") return `${card.initialShields} 理智盾`;
  return `${card.cost} DP`;
}

export function phaseActionLabel(phase: Phase) {
  if (phase === "ready") return "执行准备阶段";
  if (phase === "draw") return "执行抽牌阶段";
  if (phase === "main") return "结束主要阶段";
  if (phase === "end") return "结束回合";
  return "继续";
}
