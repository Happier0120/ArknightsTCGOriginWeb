import { useState } from "react";
import type { GameContent } from "../../content";
import type { GameState, PlayerId } from "../../game";
import { cardSummary, getCard, playerLabels } from "./gameUi";

interface MulliganViewProps {
  content: GameContent;
  state: GameState;
  playerId: PlayerId;
  onSubmit: (cardIds: string[]) => void;
}

export function MulliganView({
  content,
  state,
  playerId,
  onSubmit,
}: MulliganViewProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const player = state.players[playerId];

  const toggle = (instanceId: string) => {
    setSelected((current) => {
      if (current.includes(instanceId)) {
        return current.filter((id) => id !== instanceId);
      }
      return current.length < 2 ? [...current, instanceId] : current;
    });
  };

  return (
    <section className="mulligan" aria-labelledby="mulligan-heading">
      <p className="eyebrow">秘密调度</p>
      <h2 id="mulligan-heading">{playerLabels[playerId]}：起手调度</h2>
      <p className="game-help">选择至多2张牌。补抽完成后，选中的牌才会洗回牌库。</p>

      <div className="mulligan-hand">
        {player.hand.map((instanceId) => {
          const card = getCard(content, state, instanceId);
          const isSelected = selected.includes(instanceId);
          return (
            <button
              aria-label={`${isSelected ? "取消选择" : "选择"}${card.name}`}
              aria-pressed={isSelected}
              className="mulligan-card"
              key={instanceId}
              onClick={() => toggle(instanceId)}
              type="button"
            >
              <span>{card.type === "operator" ? "干员" : card.type === "field" ? "场地" : "战术支援"}</span>
              <strong>{card.name}</strong>
              <small>{cardSummary(card)}</small>
              <em>{isSelected ? "将被替换" : "保留"}</em>
            </button>
          );
        })}
      </div>

      <div className="mulligan-actions">
        <span>已选择 {selected.length}/2</span>
        <button
          className="game-primary-button"
          onClick={() => onSubmit(selected)}
          type="button"
        >
          {selected.length === 0 ? "保留全部起手" : `替换${selected.length}张牌`}
        </button>
      </div>
    </section>
  );
}

