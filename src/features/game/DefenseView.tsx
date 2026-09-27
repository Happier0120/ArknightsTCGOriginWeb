import type { GameContent } from "../../content";
import {
  getLegalInterceptors,
  type GameState,
  type PlayerId,
} from "../../game";
import { Battlefield } from "./Battlefield";
import { getCard, playerLabels } from "./gameUi";

interface DefenseViewProps {
  content: GameContent;
  state: GameState;
  onResolve: (playerId: PlayerId, interceptSlotIndex: number | null) => void;
}

export function DefenseView({ content, state, onResolve }: DefenseViewProps) {
  const pending = state.pendingAttack;
  if (!pending) return null;
  const attacker = state.players[pending.attackerPlayerId]
    .deploymentSlots[pending.attackerSlotIndex];
  if (!attacker) return null;
  const attackerCard = getCard(content, state, attacker.instanceId);
  const defender = state.players[pending.defenderPlayerId];
  const legalInterceptors = getLegalInterceptors(state, content);
  const targetLabel =
    pending.target.kind === "shield"
      ? `${playerLabels[pending.defenderPlayerId]}的理智盾`
      : (() => {
          const target = defender.deploymentSlots[pending.target.slotIndex];
          return target
            ? `「${getCard(content, state, target.instanceId).name}」`
            : "已离场的干员";
        })();

  return (
    <section className="defense-view" aria-labelledby="defense-heading">
      <div className="defense-heading">
        <div>
          <p className="eyebrow">防守步骤 · 公开信息</p>
          <h2 id="defense-heading">
            {playerLabels[pending.defenderPlayerId]}：是否拦截？
          </h2>
        </div>
        <span>{defender.shields} 理智盾</span>
      </div>

      <div className="attack-summary">
        <span>攻击者</span>
        <strong>「{attackerCard.name}」</strong>
        <span>→</span>
        <span>原目标</span>
        <strong>{targetLabel}</strong>
      </div>

      <Battlefield
        content={content}
        mirrored
        playerId={pending.attackerPlayerId}
        selectedOperatorId={null}
        state={state}
      />
      <Battlefield
        content={content}
        playerId={pending.defenderPlayerId}
        selectedOperatorId={null}
        state={state}
      />

      <div className="intercept-controls">
        <div>
          <h3>选择拦截者</h3>
          <p>
            {legalInterceptors.length > 0
              ? "选择一名合法干员拦截，或让原目标承受攻击。"
              : "当前没有合法拦截者，原目标将承受攻击。"}
          </p>
        </div>
        <div className="interceptor-options">
          {legalInterceptors.map((slotIndex) => {
            const deployed = defender.deploymentSlots[slotIndex];
            if (!deployed) return null;
            const card = getCard(content, state, deployed.instanceId);
            return (
              <button
                aria-label={`用${card.name}拦截`}
                key={slotIndex}
                onClick={() =>
                  onResolve(pending.defenderPlayerId, slotIndex)
                }
                type="button"
              >
                <strong>{card.name}</strong>
                <span>位置 {slotIndex + 1} · 横置并拦截</span>
              </button>
            );
          })}
          <button
            className="no-intercept-button"
            onClick={() => onResolve(pending.defenderPlayerId, null)}
            type="button"
          >
            不拦截，结算攻击
          </button>
        </div>
      </div>
    </section>
  );
}
