import type { GameContent } from "../../content";
import {
  getLegalTriggerTargets,
  type GameState,
  type PlayerId,
  type TriggerTarget,
} from "../../game";
import { getCard, playerLabels } from "./gameUi";

interface TriggerQueueViewProps {
  content: GameContent;
  state: GameState;
  onConfirmHandoff: (playerId: PlayerId) => void;
  onResolve: (
    playerId: PlayerId,
    triggerId: number,
    action: "activate" | "skip",
    target?: TriggerTarget,
    discardInstanceId?: string,
  ) => void;
  onReset: () => void;
  resetLabel?: string;
  hideReset?: boolean;
}

const eventLabels = {
  operator_deployed: "干员部署完成",
  operator_retreated: "干员主动撤退完成",
  operator_defeated: "干员被击溃",
} as const;

export function TriggerQueueView({
  content,
  state,
  onConfirmHandoff,
  onResolve,
  onReset,
  resetLabel = "放弃当前测试对局",
  hideReset = false,
}: TriggerQueueViewProps) {
  const currentTrigger = state.triggerQueue[0];
  if (!currentTrigger) return null;
  if (state.currentViewer !== currentTrigger.controllerId) {
    return (
      <section className="handoff trigger-handoff" aria-labelledby="trigger-handoff-heading">
        <div className="handoff-icon" aria-hidden="true">↔</div>
        <p className="eyebrow">触发结算交接</p>
        <h2 id="trigger-handoff-heading">
          请将设备交给{playerLabels[currentTrigger.controllerId]}
        </h2>
        <p>下一项能力由该玩家控制。接手前不会显示其手牌选择。</p>
        <button
          className="game-primary-button"
          onClick={() => onConfirmHandoff(currentTrigger.controllerId)}
          type="button"
        >
          我是{playerLabels[currentTrigger.controllerId]}，已接手
        </button>
      </section>
    );
  }

  const legalTargets = getLegalTriggerTargets(state, content, currentTrigger);
  const needsTarget = new Set([
    "RI-E005",
    "RI-E007",
    "RI-E011",
    "RM-E003",
    "RM-E005",
    "RM-E006",
    "RM-E007",
    "RM-E008",
    "RI-E018",
    "RM-E017",
  ]).has(currentTrigger.effectId);
  const batches = new Map<number, typeof state.triggerQueue>();
  for (const trigger of state.triggerQueue) {
    batches.set(trigger.batchId, [
      ...(batches.get(trigger.batchId) ?? []),
      trigger,
    ]);
  }

  return (
    <section className="trigger-queue" aria-labelledby="trigger-queue-heading">
      <div className="trigger-queue__heading">
        <div>
          <p className="eyebrow">模块 5.3 · 触发结算</p>
          <h2 id="trigger-queue-heading">等待结算 {state.triggerQueue.length} 项能力</h2>
        </div>
        <span>当前行动已暂停</span>
      </div>

      <p className="trigger-queue__help">
        同一事件产生的能力归入同一批次，当前回合玩家的能力排在非当前回合玩家之前。
        来源快照已经保存，即使干员已离开部署区，能力仍会保留。现在请按队列顺序决定是否发动并选择合法目标。
      </p>

      {[...batches.entries()].map(([batchId, triggers]) => (
        <section className="trigger-batch" key={batchId}>
          <div className="trigger-batch__heading">
            <strong>批次 #{batchId}</strong>
            <span>{eventLabels[triggers[0].event.kind]}</span>
          </div>
          <ol>
            {triggers.map((trigger, index) => {
              const card = content.cards.find(
                (candidate) => candidate.id === trigger.sourceDefinitionId,
              );
              const effect = content.effects.find(
                (candidate) => candidate.id === trigger.effectId,
              );
              const abilityName = effect?.abilityName?.trim() ||
                (card?.type === "field" ? "场地效果" : "天赋");
              return (
                <li
                  className={trigger.id === currentTrigger.id ? "trigger-item--current" : ""}
                  key={trigger.id}
                >
                  <span className="trigger-order">{index + 1}</span>
                  <div>
                    <div className="trigger-title">
                      <strong>{card?.name ?? trigger.sourceDefinitionId} · {abilityName}</strong>
                      <span>{trigger.optional ? "可选" : "必须结算"}</span>
                    </div>
                    <p>{effect?.text ?? "缺少能力文本"}</p>
                    <small>
                      {playerLabels[trigger.controllerId]} · {trigger.priority === "active_player" ? "当前回合玩家优先组" : "非当前回合玩家组"}
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <section className="trigger-resolution" aria-labelledby="trigger-resolution-heading">
        <div>
          <span>当前结算</span>
          <h3 id="trigger-resolution-heading">
            {content.cards.find((card) => card.id === currentTrigger.sourceDefinitionId)?.name}
            {" · "}
            {content.effects.find((effect) => effect.id === currentTrigger.effectId)?.abilityName ||
              (content.cards.find((card) => card.id === currentTrigger.sourceDefinitionId)?.type === "field"
                ? "场地效果"
                : "天赋")}
          </h3>
        </div>

        {currentTrigger.stage === "discard_after_draw" ? (
          <div className="trigger-choice-block">
            <p>已抽1张牌。请选择1张手牌弃置，以完成能力结算。</p>
            <div className="trigger-targets">
              {state.players[currentTrigger.controllerId].hand.map((instanceId) => {
                const card = getCard(content, state, instanceId);
                return (
                  <button
                    key={instanceId}
                    onClick={() => onResolve(
                      currentTrigger.controllerId,
                      currentTrigger.id,
                      "activate",
                      undefined,
                      instanceId,
                    )}
                    type="button"
                  >
                    <span>弃置手牌</span>
                    <strong>{card.name}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="trigger-choice-block">
            {needsTarget ? (
              <>
                <p>{legalTargets.length > 0 ? "选择能力的结算目标。" : "当前没有合法目标，该能力将不产生效果。"}</p>
                <div className="trigger-targets">
                  {legalTargets.map((target) => {
                    const card = target.kind === "operator"
                      ? (() => {
                          const deployed = state.players[target.playerId]
                            .deploymentSlots[target.slotIndex];
                          return deployed ? getCard(content, state, deployed.instanceId) : null;
                        })()
                      : getCard(content, state, target.instanceId);
                    const key = target.kind === "operator"
                      ? `${target.playerId}-slot-${target.slotIndex}`
                      : `${target.playerId}-redeploy-${target.instanceId}`;
                    return (
                      <button
                        key={key}
                        onClick={() => onResolve(
                          currentTrigger.controllerId,
                          currentTrigger.id,
                          "activate",
                          target,
                        )}
                        type="button"
                      >
                        <span>
                          {target.kind === "operator"
                            ? `${playerLabels[target.playerId]} · 部署位${target.slotIndex + 1}`
                            : "再部署候场区"}
                        </span>
                        <strong>{card?.name ?? "未知干员"}</strong>
                      </button>
                    );
                  })}
                  {legalTargets.length === 0 ? (
                    <button
                      onClick={() => onResolve(
                        currentTrigger.controllerId,
                        currentTrigger.id,
                        "activate",
                      )}
                      type="button"
                    >
                      <strong>确认无合法目标</strong>
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <button
                className="game-primary-button"
                onClick={() => onResolve(
                  currentTrigger.controllerId,
                  currentTrigger.id,
                  "activate",
                )}
                type="button"
              >
                {currentTrigger.optional ? "发动能力" : "结算能力"}
              </button>
            )}
            {currentTrigger.optional ? (
              <button
                className="trigger-skip-button"
                onClick={() => onResolve(
                  currentTrigger.controllerId,
                  currentTrigger.id,
                  "skip",
                )}
                type="button"
              >
                不发动此能力
              </button>
            ) : null}
          </div>
        )}
      </section>

      <div className="trigger-queue__footer">
        <p>每次只处理队首能力；结算中新产生的触发会排到当前批次之后。</p>
        {hideReset ? null : (
          <button className="text-button" onClick={onReset} type="button">
            {resetLabel}
          </button>
        )}
      </div>
    </section>
  );
}
