import { useEffect, useState } from "react";
import type { GameContent } from "../../content";
import type { GameCommand, GameState, PlayerId } from "../../game";
import { CardHoverDetail } from "./CardHoverDetail";
import { cardSummary, getCard, playerLabels } from "./gameUi";

type ResolutionAction = Extract<
  GameCommand,
  { type: "RESOLVE_TACTICAL_SUPPORT" }
>["action"];

interface TacticalSupportResolutionViewProps {
  content: GameContent;
  state: GameState;
  onResolve: (playerId: PlayerId, action: ResolutionAction) => void;
  onReset: () => void;
  resetLabel?: string;
  hideReset?: boolean;
}

export function TacticalSupportResolutionView({
  content,
  state,
  onResolve,
  onReset,
  resetLabel = "放弃当前测试对局",
  hideReset = false,
}: TacticalSupportResolutionViewProps) {
  const pending = state.pendingTacticalSupport;
  const [orderedIds, setOrderedIds] = useState<string[]>(
    pending?.kind === "deck_search_order" ? pending.remainingInstanceIds : [],
  );

  useEffect(() => {
    if (pending?.kind === "deck_search_order") {
      setOrderedIds(pending.remainingInstanceIds);
    }
  }, [pending]);

  if (!pending) return null;
  const source = getCard(content, state, pending.sourceInstanceId);
  const player = state.players[pending.controllerId];

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedIds.length) return;
    setOrderedIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <section className="support-resolution" aria-labelledby="support-resolution-heading">
      <div className="match-topline">
        <div>
          <p className="eyebrow">模块 6.2 · 战术支援结算</p>
          <h2 id="support-resolution-heading">
            {playerLabels[pending.controllerId]} · {source.name}
          </h2>
        </div>
        {hideReset ? null : (
          <button className="text-button" onClick={onReset} type="button">
            {resetLabel}
          </button>
        )}
      </div>

      {pending.kind === "deck_search_choice" ? (
        <>
          <div className="game-section-heading">
            <div>
              <h3>查看牌库顶牌</h3>
              <p>
                可以选择一张部署费用不高于 {pending.maximumOperatorCost} 的同阵营干员加入手牌。
              </p>
            </div>
          </div>
          <div className="game-hand-cards">
            {pending.revealedInstanceIds.map((instanceId) => {
              const card = getCard(content, state, instanceId);
              const legal =
                card.type === "operator" &&
                card.faction === source.faction &&
                card.cost <= pending.maximumOperatorCost;
              return (
                <CardHoverDetail
                  card={card}
                  className="game-hand-hover-target"
                  content={content}
                  key={instanceId}
                >
                  <button
                    aria-label={`将${card.name}加入手牌`}
                    className="game-hand-card game-hand-card--button"
                    disabled={!legal}
                    onClick={() =>
                      onResolve(pending.controllerId, {
                        type: "CHOOSE_SEARCH_RESULT",
                        instanceId,
                      })
                    }
                    type="button"
                  >
                    <span>{card.type === "operator" ? "干员" : "其他卡牌"}</span>
                    <strong>{card.name}</strong>
                    <small>{cardSummary(card)}</small>
                    <em>{legal ? "加入手牌" : "不符合检索条件"}</em>
                  </button>
                </CardHoverDetail>
              );
            })}
          </div>
          <button
            className="game-primary-button support-resolution__skip"
            onClick={() =>
              onResolve(pending.controllerId, {
                type: "CHOOSE_SEARCH_RESULT",
                instanceId: null,
              })
            }
            type="button"
          >
            不选择干员
          </button>
        </>
      ) : null}

      {pending.kind === "deck_search_order" ? (
        <>
          <div className="game-section-heading">
            <div>
              <h3>排列牌库底顺序</h3>
              <p>列表顶部的牌会先放入牌库底，排在后面的牌更靠近牌库最底端。</p>
            </div>
          </div>
          <ol className="support-order-list">
            {orderedIds.map((instanceId, index) => {
              const card = getCard(content, state, instanceId);
              return (
                <li key={instanceId}>
                  <span>{index + 1}</span>
                  <strong>{card.name}</strong>
                  <div>
                    <button
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      上移
                    </button>
                    <button
                      disabled={index === orderedIds.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      下移
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            className="game-primary-button"
            onClick={() =>
              onResolve(pending.controllerId, {
                type: "ORDER_SEARCH_REMAINDER",
                instanceIds: orderedIds,
              })
            }
            type="button"
          >
            确认牌库底顺序
          </button>
        </>
      ) : null}

      {pending.kind === "discard_after_draw" ? (
        <>
          <div className="game-section-heading">
            <div>
              <h3>抽二弃一</h3>
              <p>已抽取 2 张牌；请选择一张当前手牌弃置。</p>
            </div>
          </div>
          <div className="game-hand-cards">
            {player.hand.map((instanceId) => {
              const card = getCard(content, state, instanceId);
              return (
                <CardHoverDetail
                  card={card}
                  className="game-hand-hover-target"
                  content={content}
                  key={instanceId}
                >
                  <button
                    aria-label={`弃置手牌${card.name}`}
                    className="game-hand-card game-hand-card--button"
                    onClick={() =>
                      onResolve(pending.controllerId, {
                        type: "DISCARD_HAND_CARD",
                        instanceId,
                      })
                    }
                    type="button"
                  >
                    <span>当前手牌</span>
                    <strong>{card.name}</strong>
                    <small>{cardSummary(card)}</small>
                    <em>选择弃置</em>
                  </button>
                </CardHoverDetail>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
