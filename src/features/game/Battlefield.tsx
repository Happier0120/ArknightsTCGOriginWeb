import type { ReactNode } from "react";
import type { GameContent } from "../../content";
import { getOperatorArt } from "../../art/operatorArt";
import {
  getCurrentOperatorStats,
  getActiveAbilityOptions,
  hasAttackPermission,
  hasGrantedKeyword,
  type GameState,
  type PlayerId,
} from "../../game";
import { CardHoverDetail } from "./CardHoverDetail";
import { getCard, playerLabels } from "./gameUi";

const positionLabels = {
  ground: "地面",
  high_ground: "高台",
} as const;

interface BattlefieldProps {
  content: GameContent;
  state: GameState;
  playerId: PlayerId;
  mirrored?: boolean;
  selectedOperatorId: string | null;
  selectedAttackerSlot?: number | null;
  attackableSlots?: number[];
  commander?: ReactNode;
  onDeploy?: (slotIndex: number) => void;
  onRetreat?: (slotIndex: number) => void;
  onSelectAttacker?: (slotIndex: number) => void;
  onActivateSkill?: (slotIndex: number) => void;
}

export function Battlefield({
  content,
  state,
  playerId,
  mirrored = false,
  selectedOperatorId,
  selectedAttackerSlot = null,
  attackableSlots = [],
  commander,
  onDeploy,
  onRetreat,
  onSelectAttacker,
  onActivateSkill,
}: BattlefieldProps) {
  const player = state.players[playerId];
  const deployedCount = player.deploymentSlots.filter(Boolean).length;
  const selectedCard = selectedOperatorId
    ? getCard(content, state, selectedOperatorId)
    : null;
  const displayedSlots = player.deploymentSlots
    .map((deployed, slotIndex) => ({ deployed, slotIndex }))
    .reverse();
  if (!mirrored) displayedSlots.reverse();

  const deploymentSlots = (
    <div className="deployment-slots">
      {displayedSlots.map(({ deployed, slotIndex }) => {
        if (!deployed) {
          const canPlace = Boolean(
            onDeploy &&
            selectedCard?.type === "operator" &&
            deployedCount < player.deploymentCapacity,
          );
          return canPlace ? (
            <button
              aria-label={`部署到位置${slotIndex + 1}`}
              className="operator-slot operator-slot--target"
              key={slotIndex}
              onClick={() => onDeploy?.(slotIndex)}
              type="button"
            >
              <span>位置 {slotIndex + 1}</span>
              <strong>部署至此</strong>
            </button>
          ) : (
            <div className="operator-slot operator-slot--empty" key={slotIndex}>
              <span>位置 {slotIndex + 1}</span>
              <strong>空置</strong>
            </div>
          );
        }

        const card = getCard(content, state, deployed.instanceId);
        if (card.type !== "operator") return null;
        const currentStats = getCurrentOperatorStats(
          content,
          state,
          playerId,
          slotIndex,
        );
        if (!currentStats) return null;
        const artOrientation = deployed.isUpright ? "Vertical" : "Horizontal";
        const artUrl = getOperatorArt(card.name, artOrientation);
        const justDeployed = deployed.deployedTurn === state.turnNumber;
        const canRetreat = Boolean(
          onRetreat &&
            state.phase === "main" &&
            state.activePlayer === playerId &&
            deployed.isUpright &&
            !justDeployed,
        );
        const canAttack = Boolean(
          onSelectAttacker && attackableSlots.includes(slotIndex),
        );
        const skillEffect = content.effects.find(
          (effect) => effect.cardId === card.id && effect.category === "技能",
        );
        const skillOptions = skillEffect
          ? getActiveAbilityOptions(state, content, playerId, {
              kind: "operator",
              slotIndex,
            })
          : null;
        const canActivateSkill = Boolean(
          onActivateSkill && skillOptions && skillOptions.kind !== "unavailable",
        );

        return (
          <CardHoverDetail
            card={card}
            className="operator-slot-hover-target"
            content={content}
            key={slotIndex}
          >
            <article
              className={`operator-slot operator-slot--occupied${artUrl ? " operator-slot--with-art" : ""}${deployed.isUpright ? "" : " operator-slot--tapped"}`}
              data-art-orientation={artUrl ? artOrientation : undefined}
            >
            {artUrl ? (
              <video
                aria-hidden="true"
                autoPlay
                className="operator-art"
                data-testid={`operator-art-${card.name}`}
                key={artUrl}
                loop={deployed.isUpright}
                muted
                playsInline
                preload="metadata"
                src={artUrl}
              />
            ) : null}
            <div className="operator-slot-topline">
              <span>位置 {slotIndex + 1}</span>
              <span>{positionLabels[card.position]}</span>
            </div>
            <strong>{card.name}</strong>
            <small>{currentStats.atk} ATK · {currentStats.def} DEF</small>
            <small>生命 {deployed.currentLife}/{card.life}</small>
            <div className="operator-status-row">
              <span>{deployed.isUpright ? "竖置" : "横置"}</span>
              {justDeployed ? <span>刚部署</span> : null}
              {hasGrantedKeyword(state, deployed.instanceId, "intercept") ? (
                <span>获得拦截</span>
              ) : null}
              {justDeployed &&
              hasAttackPermission(
                state,
                deployed.instanceId,
                "ignore_deployment_turn",
              ) ? (
                <span>可立即攻击</span>
              ) : null}
            </div>
            {canRetreat ? (
              <button
                aria-label={`撤退${card.name}`}
                className="retreat-button"
                onClick={() => onRetreat?.(slotIndex)}
                type="button"
              >
                撤退 · 返费 {card.retreatRefund} DP
              </button>
            ) : null}
            {canAttack ? (
              <button
                aria-label={`${selectedAttackerSlot === slotIndex ? "取消选择" : "选择"}${card.name}发起攻击`}
                aria-pressed={selectedAttackerSlot === slotIndex}
                className="attack-button"
                onClick={() => onSelectAttacker?.(slotIndex)}
                type="button"
              >
                {selectedAttackerSlot === slotIndex ? "取消攻击" : "发起攻击"}
              </button>
            ) : null}
            {skillEffect && onActivateSkill ? (
              <button
                aria-label={`发动${card.name}的${skillEffect.abilityName || "技能"}`}
                className="skill-button"
                disabled={!canActivateSkill}
                onClick={() => onActivateSkill(slotIndex)}
                title={
                  skillOptions?.kind === "unavailable"
                    ? skillOptions.reason
                    : undefined
                }
                type="button"
              >
                发动技能
              </button>
            ) : null}
            </article>
          </CardHoverDetail>
        );
      })}
    </div>
  );

  const redeployZone = (
    <div className="redeploy-zone">
      <div>
        <strong>再部署候场区</strong>
        <span>{player.redeployZone.length} 名干员</span>
      </div>
      {player.redeployZone.length > 0 ? (
        <ul>
          {player.redeployZone.map((entry) => {
            const card = getCard(content, state, entry.instanceId);
            return (
              <li key={entry.instanceId}>
                <CardHoverDetail
                  card={card}
                  className="redeploy-card-hover-target"
                  content={content}
                >
                  <span>{card.name}</span>
                  <strong>CD {entry.remainingCd}</strong>
                </CardHoverDetail>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>暂无候场干员</p>
      )}
    </div>
  );

  const deploymentLine = (
    <div className="deployment-line">
      {commander}
      {deploymentSlots}
    </div>
  );

  return (
    <section
      className={`battlefield${mirrored ? " battlefield--mirrored" : ""}`}
      aria-label={`${playerLabels[playerId]}部署区`}
      data-orientation={mirrored ? "mirrored" : "normal"}
    >
      <div className="battlefield-heading">
        <div>
          <span>{playerLabels[playerId]}</span>
          <strong>干员部署区</strong>
        </div>
        <span>{deployedCount}/{player.deploymentCapacity}</span>
      </div>

      {mirrored ? redeployZone : deploymentLine}
      {mirrored ? deploymentLine : redeployZone}
    </section>
  );
}
