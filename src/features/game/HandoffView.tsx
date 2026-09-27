import type { GameState, PlayerId } from "../../game";
import { playerLabels } from "./gameUi";

interface HandoffViewProps {
  state: GameState;
  onConfirm: (playerId: PlayerId) => void;
}

export function HandoffView({ state, onConfirm }: HandoffViewProps) {
  const handoff = state.handoff;
  if (!handoff) return null;
  const nextPlayer = handoff.nextPlayer;
  const resume = handoff.resume;
  const helpText =
    resume === "mulligan"
      ? "下一位玩家将查看自己的起手牌并完成调度。"
      : resume === "start_turn"
        ? "下一位玩家将开始自己的回合。"
        : resume === "defend_attack"
          ? "下一位玩家将查看公开战场并决定是否拦截；双方手牌保持隐藏。"
          : "攻击已经结算，请交还回合玩家继续主要阶段。";

  return (
    <section className="handoff" aria-labelledby="handoff-heading">
      <div className="handoff-icon" aria-hidden="true">↔</div>
      <p className="eyebrow">隐藏信息保护</p>
      <h2 id="handoff-heading">请将设备交给{playerLabels[nextPlayer]}</h2>
      <p>{helpText}</p>
      <button
        className="game-primary-button"
        onClick={() => onConfirm(nextPlayer)}
        type="button"
      >
        我是{playerLabels[nextPlayer]}，已接手
      </button>
    </section>
  );
}
