import { useEffect, useState } from "react";
import type { GameContent } from "../../content";
import { getOperatorArt } from "../../art/operatorArt";
import {
  getActiveAbilityOptions,
  getDeploymentCost,
  getFieldPlayOptions,
  getCurrentOperatorStats,
  getLegalAttackTargets,
  getTacticalSupportPlayOptions,
  type AttackTarget,
  type ActiveAbilitySource,
  type ActiveAbilityTarget,
  type GameState,
  type PlayerId,
  type TacticalSupportTarget,
} from "../../game";
import { Battlefield } from "./Battlefield";
import { CardHoverDetail } from "./CardHoverDetail";
import {
  cardSummary,
  getCard,
  phaseActionLabel,
  phaseLabels,
  playerLabels,
} from "./gameUi";

interface MatchViewProps {
  content: GameContent;
  state: GameState;
  viewerId?: PlayerId;
  onAdvance: (playerId: PlayerId) => void;
  onActivateAbility: (
    playerId: PlayerId,
    source: ActiveAbilitySource,
    target: ActiveAbilityTarget,
  ) => void;
  onDeploy: (playerId: PlayerId, cardInstanceId: string, slotIndex: number) => void;
  onDeclareAttack: (
    playerId: PlayerId,
    attackerSlotIndex: number,
    target: AttackTarget,
  ) => void;
  onPlayTacticalSupport: (
    playerId: PlayerId,
    cardInstanceId: string,
    target?: TacticalSupportTarget,
  ) => void;
  onPlayField: (playerId: PlayerId, cardInstanceId: string) => void;
  onRetreat: (playerId: PlayerId, slotIndex: number) => void;
  onReset: () => void;
  resetLabel?: string;
  hideReset?: boolean;
}

function CommanderArea({
  content,
  state,
  playerId,
  mirrored = false,
  onActivate,
}: {
  content: GameContent;
  state: GameState;
  playerId: PlayerId;
  mirrored?: boolean;
  onActivate?: () => void;
}) {
  const player = state.players[playerId];
  const commander = content.cards.find((card) => card.id === player.commanderId);
  if (!commander || commander.type !== "commander") return null;
  const artOrientation = player.commanderIsUpright ? "Vertical" : "Horizontal";
  const artUrl = getOperatorArt(commander.name, artOrientation);
  const options = getActiveAbilityOptions(state, content, playerId, {
    kind: "commander",
  });
  const canActivate = Boolean(onActivate && options.kind !== "unavailable");
  const contents = (
    <article className={`commander-card${artUrl ? " commander-card--with-art" : ""}${player.commanderIsUpright ? "" : " commander-card--tapped"}`}>
      {artUrl ? (
        <video
          aria-hidden="true"
          autoPlay
          className="commander-art"
          data-art-orientation={artOrientation}
          key={artUrl}
          loop={player.commanderIsUpright}
          muted
          playsInline
          preload="metadata"
          src={artUrl}
        />
      ) : null}
      <div>
        <span>{mirrored ? "敌方指挥官" : "己方指挥官"}</span>
        <strong>{commander.name}</strong>
      </div>
      <dl>
        <div><dt>当前理智</dt><dd>{player.shields}/{commander.initialShields}</dd></div>
        <div><dt>状态</dt><dd>{player.commanderIsUpright ? "竖置" : "横置"}</dd></div>
      </dl>
      {onActivate ? (
        <button
          aria-label={`发动${commander.name}的指挥官指令`}
          disabled={!canActivate}
          onClick={onActivate}
          title={options.kind === "unavailable" ? options.reason : undefined}
          type="button"
        >
          发动指挥官指令
        </button>
      ) : null}
    </article>
  );
  return (
    <section
      aria-label={`${playerLabels[playerId]}指挥官区`}
      className={`commander-area${mirrored ? " commander-area--mirrored" : ""}`}
    >
      <CardHoverDetail card={commander} content={content}>
        {contents}
      </CardHoverDetail>
    </section>
  );
}

function PlayerSummary({
  state,
  playerId,
  compact = false,
}: {
  state: GameState;
  playerId: PlayerId;
  compact?: boolean;
}) {
  const player = state.players[playerId];
  return (
    <section className={`player-summary${compact ? " player-summary--compact" : ""}`}>
      <div>
        <span>{playerLabels[playerId]}</span>
        <strong>{player.shields} 理智盾</strong>
      </div>
      <dl>
        <div><dt>DP</dt><dd>{player.availableDp}/{player.maxDp}</dd></div>
        <div><dt>手牌</dt><dd>{player.hand.length}</dd></div>
        <div><dt>牌库</dt><dd>{player.drawPile.length}</dd></div>
        <div><dt>废弃</dt><dd>{player.discardPile.length}</dd></div>
        <div><dt>部署</dt><dd>{player.deploymentSlots.filter(Boolean).length}/{player.deploymentCapacity}</dd></div>
        <div><dt>候场</dt><dd>{player.redeployZone.length}</dd></div>
      </dl>
    </section>
  );
}

function SharedFieldArea({
  content,
  state,
}: {
  content: GameContent;
  state: GameState;
}) {
  if (!state.sharedField) {
    return (
      <section className="shared-field-placeholder" aria-label="共享场地区">
        <span>共享场地区</span>
        <strong>当前没有场地卡</strong>
      </section>
    );
  }
  const card = getCard(content, state, state.sharedField.instanceId);
  const effect = content.effects.find((candidate) => candidate.cardId === card.id);
  return (
    <section className="shared-field" aria-label="共享场地区">
      <CardHoverDetail card={card} content={content}>
        <article className={`shared-field-card shared-field-card--${card.faction}`}>
          <div>
            <span>当前场地 · {playerLabels[state.sharedField.controllerId]}控制</span>
            <strong>{card.name}</strong>
          </div>
          <p>{effect?.abilityName || "场地效果"} · {effect?.text}</p>
          <small>使用费用 {card.type === "field" ? card.cost : "-"} DP</small>
        </article>
      </CardHoverDetail>
    </section>
  );
}

function OngoingEffectsPanel({
  content,
  state,
}: {
  content: GameContent;
  state: GameState;
}) {
  const expiryLabel = (effect: GameState["ongoingEffects"][number]) =>
    effect.expires.kind === "turn_end"
      ? `第 ${effect.expires.turnNumber} 回合结束`
      : `${playerLabels[effect.expires.playerId]}下个准备阶段开始`;
  const targetName = (instanceId: string) =>
    getCard(content, state, instanceId).name;
  const effectLabel = (effect: GameState["ongoingEffects"][number]) => {
    if (effect.kind === "next_deployment") {
      return effect.payload === "grant_intercept"
        ? "下一名合格干员获得【拦截】"
        : "下一名合格干员可在部署回合攻击";
    }
    if (effect.kind === "granted_keyword") {
      return `${targetName(effect.targetInstanceId)}获得【拦截】`;
    }
    if (effect.kind === "attack_permission") {
      return `${targetName(effect.targetInstanceId)}可在部署回合攻击`;
    }
    if (effect.kind === "deployment_cost_modifier") {
      return `${targetName(effect.targetInstanceId)}本回合下一次部署费用${effect.amount}`;
    }
    const changes = [
      effect.atkDelta ? `ATK ${effect.atkDelta > 0 ? "+" : ""}${effect.atkDelta}` : "",
      effect.defDelta ? `DEF ${effect.defDelta > 0 ? "+" : ""}${effect.defDelta}` : "",
    ].filter(Boolean).join(" · ");
    return `${targetName(effect.targetInstanceId)} ${changes}${effect.effectId === "RM-E001" ? " · 击破额外伤害 +1" : ""}`;
  };
  const currentUsages = state.effectUsages.filter(
    (usage) => usage.turnNumber === state.turnNumber,
  );

  return (
    <section className="ongoing-effects" aria-labelledby="ongoing-effects-heading">
      <div className="ongoing-effects__heading">
        <div>
          <span>规则状态</span>
          <h3 id="ongoing-effects-heading">持续效果与限次</h3>
        </div>
        <strong>{state.ongoingEffects.length} 项生效中</strong>
      </div>
      {state.ongoingEffects.length > 0 ? (
        <ul>
          {state.ongoingEffects.map((effect) => (
            <li key={effect.id}>
              <span>{playerLabels[effect.controllerId]}</span>
              <strong>{effectLabel(effect)}</strong>
              <small>到期：{expiryLabel(effect)}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p>当前没有持续效果。</p>
      )}
      {currentUsages.length > 0 ? (
        <div className="effect-usages" aria-label="本回合能力使用次数">
          {currentUsages.map((usage) => (
            <span key={`${usage.controllerId}-${usage.effectId}-${usage.sourceInstanceId ?? "shared"}`}>
              {playerLabels[usage.controllerId]} · {usage.effectId} 已使用 {usage.count} 次
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function MatchView({
  content,
  state,
  onActivateAbility,
  onAdvance,
  onDeploy,
  onDeclareAttack,
  onPlayField,
  onPlayTacticalSupport,
  onRetreat,
  onReset,
  resetLabel = "放弃当前测试对局",
  hideReset = false,
  viewerId,
}: MatchViewProps) {
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [selectedSupportId, setSelectedSupportId] = useState<string | null>(null);
  const [selectedAttackerSlot, setSelectedAttackerSlot] = useState<number | null>(null);
  const [selectedAbilitySource, setSelectedAbilitySource] = useState<ActiveAbilitySource | null>(null);
  const [selectedSacrificeSlot, setSelectedSacrificeSlot] = useState<number | null>(null);
  const [selectedRedeployIds, setSelectedRedeployIds] = useState<string[]>([]);
  const [selectedFreeDeployId, setSelectedFreeDeployId] = useState<string | null>(null);
  const active = viewerId ?? state.activePlayer;
  const canAct =
    state.activePlayer === active && state.currentViewer === active;
  const opponent: PlayerId = active === "player1" ? "player2" : "player1";

  useEffect(() => {
    if (
      state.phase !== "main" ||
      (selectedOperatorId && !state.players[active].hand.includes(selectedOperatorId)) ||
      (selectedSupportId && !state.players[active].hand.includes(selectedSupportId))
    ) {
      setSelectedOperatorId(null);
      setSelectedSupportId(null);
    }
  }, [active, selectedOperatorId, selectedSupportId, state.phase, state.players]);

  const attackableSlots = canAct ? state.players[active].deploymentSlots.flatMap(
    (deployed, slotIndex) =>
      deployed &&
      getLegalAttackTargets(state, content, active, slotIndex).length > 0
        ? [slotIndex]
        : [],
  ) : [];
  const legalAttackTargets =
    selectedAttackerSlot === null
      ? []
      : getLegalAttackTargets(state, content, active, selectedAttackerSlot);
  const selectedSupportOptions = selectedSupportId
    ? getTacticalSupportPlayOptions(state, content, active, selectedSupportId)
    : null;
  const selectedAbilityOptions = selectedAbilitySource
    ? getActiveAbilityOptions(state, content, active, selectedAbilitySource)
    : null;

  const clearAbilitySelection = () => {
    setSelectedAbilitySource(null);
    setSelectedSacrificeSlot(null);
    setSelectedRedeployIds([]);
    setSelectedFreeDeployId(null);
  };

  useEffect(() => {
    if (
      state.phase !== "main" ||
      !canAct ||
      (selectedAttackerSlot !== null &&
        !attackableSlots.includes(selectedAttackerSlot))
    ) {
      setSelectedAttackerSlot(null);
    }
  }, [attackableSlots, canAct, selectedAttackerSlot, state.phase]);

  useEffect(() => {
    if (
      state.phase !== "main" ||
      !canAct ||
      (selectedAbilitySource && selectedAbilityOptions?.kind === "unavailable")
    ) {
      setSelectedAbilitySource(null);
      setSelectedSacrificeSlot(null);
      setSelectedRedeployIds([]);
      setSelectedFreeDeployId(null);
    }
  }, [canAct, selectedAbilityOptions, selectedAbilitySource, state.phase]);

  if (state.status === "finished") {
    return (
      <section className="game-finished" aria-labelledby="finished-heading">
        <p className="eyebrow">对局结束</p>
        <h2 id="finished-heading">{state.winner ? `${playerLabels[state.winner]}获胜` : "平局"}</h2>
        <p>
          {state.finishReason === "deck_out"
            ? "对手必须抽牌时牌库为空。"
            : "对手的最后一个理智盾已被击破。"}
        </p>
        <button className="game-primary-button" onClick={onReset} type="button">创建新对局</button>
      </section>
    );
  }

  const player = state.players[active];
  const selectedAbilitySourceCard = selectedAbilitySource?.kind === "commander"
    ? content.cards.find((card) => card.id === player.commanderId)
    : selectedAbilitySource?.kind === "operator"
      ? (() => {
          const deployed = player.deploymentSlots[selectedAbilitySource.slotIndex];
          return deployed ? getCard(content, state, deployed.instanceId) : undefined;
        })()
      : undefined;
  const selectedAbilityEffect = selectedAbilitySourceCard
    ? content.effects.find(
        (effect) =>
          effect.cardId === selectedAbilitySourceCard.id &&
          (effect.category === "技能" || effect.category === "专属指令"),
      )
    : undefined;
  return (
    <section className="match-table" aria-labelledby="match-heading">
      <div className="match-topline">
        <div>
          <p className="eyebrow">第 {state.turnNumber} 回合</p>
          <h2 id="match-heading">{playerLabels[state.activePlayer]} · {phaseLabels[state.phase]}</h2>
        </div>
        {hideReset ? null : (
          <button className="text-button" onClick={onReset} type="button">{resetLabel}</button>
        )}
      </div>

      <PlayerSummary compact playerId={opponent} state={state} />

      <Battlefield
        commander={(
          <CommanderArea
            content={content}
            mirrored
            playerId={opponent}
            state={state}
          />
        )}
        content={content}
        mirrored
        playerId={opponent}
        selectedOperatorId={null}
        state={state}
      />

      <SharedFieldArea content={content} state={state} />

      <PlayerSummary playerId={active} state={state} />

      <Battlefield
        attackableSlots={attackableSlots}
        commander={(
          <CommanderArea
            content={content}
            onActivate={canAct ? () => {
              setSelectedOperatorId(null);
              setSelectedSupportId(null);
              setSelectedAttackerSlot(null);
              setSelectedAbilitySource({ kind: "commander" });
              setSelectedSacrificeSlot(null);
              setSelectedRedeployIds([]);
              setSelectedFreeDeployId(null);
            } : undefined}
            playerId={active}
            state={state}
          />
        )}
        content={content}
        onDeploy={canAct && selectedOperatorId ? (slotIndex) => {
          onDeploy(active, selectedOperatorId, slotIndex);
          setSelectedOperatorId(null);
        } : undefined}
        onRetreat={canAct ? (slotIndex) => onRetreat(active, slotIndex) : undefined}
        onActivateSkill={canAct ? (slotIndex) => {
          setSelectedOperatorId(null);
          setSelectedSupportId(null);
          setSelectedAttackerSlot(null);
          setSelectedAbilitySource({ kind: "operator", slotIndex });
          setSelectedSacrificeSlot(null);
          setSelectedRedeployIds([]);
          setSelectedFreeDeployId(null);
        } : undefined}
        onSelectAttacker={canAct ? (slotIndex) => {
          setSelectedOperatorId(null);
          setSelectedSupportId(null);
          clearAbilitySelection();
          setSelectedAttackerSlot((selected) =>
            selected === slotIndex ? null : slotIndex,
          );
        } : undefined}
        playerId={active}
        selectedAttackerSlot={selectedAttackerSlot}
        selectedOperatorId={selectedOperatorId}
        state={state}
      />

      <OngoingEffectsPanel content={content} state={state} />

      {selectedAbilitySource && selectedAbilityOptions && selectedAbilityOptions.kind !== "unavailable" ? (
        <section className="combat-targets" aria-labelledby="ability-targets-heading">
          <div>
            <h3 id="ability-targets-heading">
              {selectedAbilitySourceCard?.name} · {selectedAbilityEffect?.abilityName || (selectedAbilitySource?.kind === "commander" ? "专属指令" : "技能")}
            </h3>
            <button className="text-button" onClick={clearAbilitySelection} type="button">
              取消发动
            </button>
          </div>
          <div className="combat-target-options">
            {selectedAbilityOptions.kind === "retreat"
              ? selectedAbilityOptions.slotIndexes.map((slotIndex) => {
                  const deployed = player.deploymentSlots[slotIndex];
                  if (!deployed) return null;
                  const card = getCard(content, state, deployed.instanceId);
                  return (
                    <button
                      aria-label={`令${card.name}主动撤退`}
                      key={deployed.instanceId}
                      onClick={() => {
                        onActivateAbility(active, selectedAbilitySource, {
                          kind: "retreat",
                          slotIndex,
                        });
                        clearAbilitySelection();
                      }}
                      type="button"
                    >
                      <span>横置干员 · 位置{slotIndex + 1}</span>
                      <strong>{card.name}</strong>
                      <small>无视竖置限制主动撤退</small>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "operator"
              ? selectedAbilityOptions.slotIndexes.map((slotIndex) => {
                  const targetPlayer = state.players[selectedAbilityOptions.playerId];
                  const deployed = targetPlayer.deploymentSlots[slotIndex];
                  if (!deployed) return null;
                  const card = getCard(content, state, deployed.instanceId);
                  return (
                    <button
                      aria-label={`选择${card.name}作为技能目标`}
                      key={deployed.instanceId}
                      onClick={() => {
                        onActivateAbility(active, selectedAbilitySource, {
                          kind: "operator",
                          playerId: selectedAbilityOptions.playerId,
                          slotIndex,
                        });
                        clearAbilitySelection();
                      }}
                      type="button"
                    >
                      <span>{playerLabels[selectedAbilityOptions.playerId]} · 位置{slotIndex + 1}</span>
                      <strong>{card.name}</strong>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "redeploy"
              ? selectedAbilityOptions.instanceIds.map((instanceId) => {
                  const card = getCard(content, state, instanceId);
                  const selected = selectedRedeployIds.includes(instanceId);
                  return (
                    <button
                      aria-label={`选择候场干员${card.name}`}
                      aria-pressed={selected}
                      key={instanceId}
                      onClick={() => {
                        if (selectedAbilityOptions.maximumSelections === 1) {
                          onActivateAbility(active, selectedAbilitySource, {
                            kind: "redeploy",
                            instanceIds: [instanceId],
                          });
                          clearAbilitySelection();
                          return;
                        }
                        setSelectedRedeployIds((current) =>
                          current.includes(instanceId)
                            ? current.filter((id) => id !== instanceId)
                            : current.length < selectedAbilityOptions.maximumSelections
                              ? [...current, instanceId]
                              : current,
                        );
                      }}
                      type="button"
                    >
                      <span>再部署候场区</span>
                      <strong>{card.name}</strong>
                      <small>{selected ? "已选择" : "CD -1"}</small>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "redeploy" &&
            selectedAbilityOptions.maximumSelections > 1 ? (
              <button
                disabled={selectedRedeployIds.length === 0}
                onClick={() => {
                  onActivateAbility(active, selectedAbilitySource, {
                    kind: "redeploy",
                    instanceIds: selectedRedeployIds,
                  });
                  clearAbilitySelection();
                }}
                type="button"
              >
                <span>已选择 {selectedRedeployIds.length}/{selectedAbilityOptions.maximumSelections}</span>
                <strong>确认发动</strong>
              </button>
            ) : null}
            {selectedAbilityOptions.kind === "free_deploy" && !selectedFreeDeployId
              ? selectedAbilityOptions.instanceIds.map((instanceId) => {
                  const card = getCard(content, state, instanceId);
                  return (
                    <button
                      aria-label={`选择免费部署${card.name}`}
                      key={instanceId}
                      onClick={() => setSelectedFreeDeployId(instanceId)}
                      type="button"
                    >
                      <span>手牌干员</span>
                      <strong>{card.name}</strong>
                      <small>选择后指定部署位</small>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "free_deploy" && selectedFreeDeployId
              ? selectedAbilityOptions.slotIndexes.map((slotIndex) => {
                  const card = getCard(content, state, selectedFreeDeployId);
                  return (
                    <button
                      aria-label={`将${card.name}免费部署到位置${slotIndex + 1}`}
                      key={slotIndex}
                      onClick={() => {
                        onActivateAbility(active, selectedAbilitySource, {
                          kind: "free_deploy",
                          instanceId: selectedFreeDeployId,
                          slotIndex,
                        });
                        clearAbilitySelection();
                      }}
                      type="button"
                    >
                      <span>空部署位</span>
                      <strong>位置 {slotIndex + 1}</strong>
                      <small>免费部署「{card.name}」</small>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "sacrifice_and_operator" && selectedSacrificeSlot === null
              ? selectedAbilityOptions.sacrificeSlotIndexes.map((slotIndex) => {
                  const deployed = player.deploymentSlots[slotIndex];
                  if (!deployed) return null;
                  const card = getCard(content, state, deployed.instanceId);
                  return (
                    <button
                      aria-label={`选择击溃${card.name}作为能力费用`}
                      key={deployed.instanceId}
                      onClick={() => setSelectedSacrificeSlot(slotIndex)}
                      type="button"
                    >
                      <span>第一步 · 支付附加费用</span>
                      <strong>击溃「{card.name}」</strong>
                    </button>
                  );
                })
              : null}
            {selectedAbilityOptions.kind === "sacrifice_and_operator" && selectedSacrificeSlot !== null
              ? selectedAbilityOptions.targetSlotIndexes
                  .filter(
                    (slotIndex) =>
                      !selectedAbilityOptions.targetsMustDiffer ||
                      slotIndex !== selectedSacrificeSlot,
                  )
                  .map((slotIndex) => {
                    const targetPlayer = state.players[selectedAbilityOptions.targetPlayerId];
                    const deployed = targetPlayer.deploymentSlots[slotIndex];
                    if (!deployed) return null;
                    const card = getCard(content, state, deployed.instanceId);
                    return (
                      <button
                        aria-label={`选择${card.name}作为能力效果目标`}
                        key={deployed.instanceId}
                        onClick={() => {
                          onActivateAbility(active, selectedAbilitySource, {
                            kind: "sacrifice_and_operator",
                            sacrificeSlotIndex: selectedSacrificeSlot,
                            targetPlayerId: selectedAbilityOptions.targetPlayerId,
                            targetSlotIndex: slotIndex,
                          });
                          clearAbilitySelection();
                        }}
                        type="button"
                      >
                        <span>第二步 · 选择效果目标</span>
                        <strong>{card.name}</strong>
                      </button>
                    );
                  })
              : null}
          </div>
        </section>
      ) : null}

      {selectedSupportId && selectedSupportOptions && selectedSupportOptions.kind !== "unavailable" ? (
        <section className="combat-targets" aria-labelledby="support-targets-heading">
          <div>
            <h3 id="support-targets-heading">
              为「{getCard(content, state, selectedSupportId).name}」选择目标
            </h3>
            <button
              className="text-button"
              onClick={() => setSelectedSupportId(null)}
              type="button"
            >
              取消使用
            </button>
          </div>
          <div className="combat-target-options">
            {selectedSupportOptions.kind === "operator"
              ? selectedSupportOptions.slotIndexes.map((slotIndex) => {
                  const deployed = player.deploymentSlots[slotIndex];
                  if (!deployed) return null;
                  const targetCard = getCard(content, state, deployed.instanceId);
                  const stats = getCurrentOperatorStats(content, state, active, slotIndex);
                  const support = getCard(content, state, selectedSupportId);
                  return (
                    <button
                      aria-label={`对${targetCard.name}使用${support.name}`}
                      key={deployed.instanceId}
                      onClick={() => {
                        onPlayTacticalSupport(active, selectedSupportId, {
                          kind: "operator",
                          slotIndex,
                        });
                        setSelectedSupportId(null);
                      }}
                      type="button"
                    >
                      <span>己方干员 · 位置{slotIndex + 1}</span>
                      <strong>{targetCard.name}</strong>
                      <small>当前 ATK {stats?.atk ?? "-"} → {(stats?.atk ?? 0) + 2}</small>
                    </button>
                  );
                })
              : null}
            {selectedSupportOptions.kind === "sacrifice"
              ? selectedSupportOptions.slotIndexes.map((slotIndex) => {
                  const deployed = player.deploymentSlots[slotIndex];
                  if (!deployed) return null;
                  const targetCard = getCard(content, state, deployed.instanceId);
                  const support = getCard(content, state, selectedSupportId);
                  return (
                    <button
                      aria-label={`击溃${targetCard.name}使用${support.name}`}
                      key={deployed.instanceId}
                      onClick={() => {
                        onPlayTacticalSupport(active, selectedSupportId, {
                          kind: "sacrifice",
                          slotIndex,
                        });
                        setSelectedSupportId(null);
                      }}
                      type="button"
                    >
                      <span>附加费用 · 位置{slotIndex + 1}</span>
                      <strong>击溃「{targetCard.name}」</strong>
                      <small>支付费用后抽 2 张牌</small>
                    </button>
                  );
                })
              : null}
            {selectedSupportOptions.kind === "redeploy"
              ? selectedSupportOptions.instanceIds.map((instanceId) => {
                  const targetCard = getCard(content, state, instanceId);
                  const support = getCard(content, state, selectedSupportId);
                  return (
                    <button
                      aria-label={`用${support.name}将${targetCard.name}返回手牌`}
                      key={instanceId}
                      onClick={() => {
                        onPlayTacticalSupport(active, selectedSupportId, {
                          kind: "redeploy",
                          instanceId,
                        });
                        setSelectedSupportId(null);
                      }}
                      type="button"
                    >
                      <span>再部署候场区 · CD 1</span>
                      <strong>{targetCard.name}</strong>
                      <small>返回手牌，下一次部署费用 -1</small>
                    </button>
                  );
                })
              : null}
            {selectedSupportOptions.kind === "discard_support"
              ? selectedSupportOptions.instanceIds.map((instanceId) => {
                  const targetCard = getCard(content, state, instanceId);
                  return (
                    <button
                      aria-label={`回收${targetCard.name}`}
                      key={instanceId}
                      onClick={() => {
                        onPlayTacticalSupport(active, selectedSupportId, {
                          kind: "discard_support",
                          instanceId,
                        });
                        setSelectedSupportId(null);
                      }}
                      type="button"
                    >
                      <span>废弃区 · 战术支援</span>
                      <strong>{targetCard.name}</strong>
                      <small>返回手牌</small>
                    </button>
                  );
                })
              : null}
          </div>
        </section>
      ) : null}

      {selectedAttackerSlot !== null ? (
        <section className="combat-targets" aria-labelledby="combat-targets-heading">
          <div>
            <h3 id="combat-targets-heading">选择攻击目标</h3>
            <button
              className="text-button"
              onClick={() => setSelectedAttackerSlot(null)}
              type="button"
            >
              取消攻击
            </button>
          </div>
          <div className="combat-target-options">
            {legalAttackTargets.map((target) => {
              const label =
                target.kind === "shield"
                  ? `${playerLabels[opponent]}理智盾`
                  : (() => {
                      const deployed = state.players[opponent]
                        .deploymentSlots[target.slotIndex];
                      return deployed
                        ? `${getCard(content, state, deployed.instanceId).name} · 位置${target.slotIndex + 1}`
                        : `位置${target.slotIndex + 1}`;
                    })();
              return (
                <button
                  aria-label={`攻击${label}`}
                  key={target.kind === "shield" ? "shield" : `operator-${target.slotIndex}`}
                  onClick={() => {
                    onDeclareAttack(active, selectedAttackerSlot, target);
                    setSelectedAttackerSlot(null);
                  }}
                  type="button"
                >
                  <span>{target.kind === "shield" ? "理智盾" : "敌方干员"}</span>
                  <strong>{label}</strong>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="game-hand" aria-label={`${playerLabels[active]}手牌`}>
        <div className="game-hand-heading">
          <h3>当前手牌</h3>
          <span>{player.hand.length} 张</span>
        </div>
        <div className="game-hand-cards">
          {player.hand.map((instanceId) => {
            const card = getCard(content, state, instanceId);
            const isOperator = card.type === "operator";
            const isTacticalSupport = card.type === "tactical_support";
            const isField = card.type === "field";
            const deployedCount = player.deploymentSlots.filter(Boolean).length;
            const deploymentCost = isOperator
              ? getDeploymentCost(state, content, instanceId)
              : null;
            const canDeploy = Boolean(
              canAct &&
                state.phase === "main" &&
                isOperator &&
                deploymentCost !== null &&
                deploymentCost <= player.availableDp &&
                deployedCount < player.deploymentCapacity &&
                player.deploymentSlots.some((slot) => slot === null),
            );
            const tacticalSupportOptions = isTacticalSupport
              ? getTacticalSupportPlayOptions(state, content, active, instanceId)
              : null;
            const canPlayTacticalSupport = Boolean(
              canAct &&
                tacticalSupportOptions && tacticalSupportOptions.kind !== "unavailable",
            );
            const fieldOptions = isField
              ? getFieldPlayOptions(state, content, active, instanceId)
              : null;
            const canPlayField = Boolean(
              canAct && fieldOptions && fieldOptions.kind !== "unavailable",
            );
            const contents = (
              <>
                <span>{isOperator ? "干员" : card.type === "field" ? "场地" : "战术支援"}</span>
                <strong>{card.name}</strong>
                <small>{cardSummary(card)}</small>
                {isOperator && state.phase === "main" ? (
                  <em>
                    {canDeploy
                      ? deploymentCost !== card.cost
                        ? `选择部署 · 减费后 ${deploymentCost} DP`
                        : "选择部署"
                      : (deploymentCost ?? card.cost) > player.availableDp
                        ? "DP不足"
                        : "无法部署"}
                  </em>
                ) : isTacticalSupport && state.phase === "main" ? (
                  <em>
                    {canPlayTacticalSupport
                      ? tacticalSupportOptions?.kind === "immediate"
                        ? "立即使用"
                        : "选择使用"
                      : tacticalSupportOptions?.kind === "unavailable"
                        ? tacticalSupportOptions.reason
                      : "无法使用"}
                  </em>
                ) : isField && state.phase === "main" ? (
                  <em>
                    {canPlayField
                      ? state.sharedField
                        ? "使用并替换当前场地"
                        : "使用场地"
                      : fieldOptions?.kind === "unavailable"
                        ? fieldOptions.reason
                        : "无法使用"}
                  </em>
                ) : null}
              </>
            );
            if (isOperator && state.phase === "main") {
              return (
                <CardHoverDetail
                  card={card}
                  className="game-hand-hover-target"
                  content={content}
                  key={instanceId}
                >
                  <button
                    aria-label={`${selectedOperatorId === instanceId ? "取消部署" : "选择部署"}${card.name}`}
                    aria-pressed={selectedOperatorId === instanceId}
                    className="game-hand-card game-hand-card--button"
                    disabled={!canDeploy}
                    onClick={() => {
                      setSelectedAttackerSlot(null);
                      setSelectedSupportId(null);
                      clearAbilitySelection();
                      setSelectedOperatorId((selected) =>
                        selected === instanceId ? null : instanceId,
                      );
                    }}
                    type="button"
                  >
                    {contents}
                  </button>
                </CardHoverDetail>
              );
            }
            if (isTacticalSupport && state.phase === "main") {
              return (
                <CardHoverDetail
                  card={card}
                  className="game-hand-hover-target"
                  content={content}
                  key={instanceId}
                >
                  <button
                    aria-label={`${selectedSupportId === instanceId
                      ? "取消使用"
                      : tacticalSupportOptions?.kind === "immediate"
                        ? "使用"
                        : "选择使用"}${card.name}`}
                    aria-pressed={selectedSupportId === instanceId}
                    className="game-hand-card game-hand-card--button"
                    disabled={!canPlayTacticalSupport}
                    onClick={() => {
                      setSelectedAttackerSlot(null);
                      setSelectedOperatorId(null);
                      clearAbilitySelection();
                      if (tacticalSupportOptions?.kind === "immediate") {
                        onPlayTacticalSupport(active, instanceId);
                        setSelectedSupportId(null);
                      } else {
                        setSelectedSupportId((selected) =>
                          selected === instanceId ? null : instanceId,
                        );
                      }
                    }}
                    type="button"
                  >
                    {contents}
                  </button>
                </CardHoverDetail>
              );
            }
            if (isField && state.phase === "main") {
              return (
                <CardHoverDetail
                  card={card}
                  className="game-hand-hover-target"
                  content={content}
                  key={instanceId}
                >
                  <button
                    aria-label={`使用${card.name}`}
                    className="game-hand-card game-hand-card--button"
                    disabled={!canPlayField}
                    onClick={() => {
                      setSelectedAttackerSlot(null);
                      setSelectedOperatorId(null);
                      setSelectedSupportId(null);
                      clearAbilitySelection();
                      onPlayField(active, instanceId);
                    }}
                    type="button"
                  >
                    {contents}
                  </button>
                </CardHoverDetail>
              );
            }
            return (
              <CardHoverDetail
                card={card}
                className="game-hand-hover-target"
                content={content}
                key={instanceId}
              >
                <article className="game-hand-card">{contents}</article>
              </CardHoverDetail>
            );
          })}
        </div>
      </section>

      {selectedOperatorId ? (
        <p className="deployment-prompt" role="status">
          已选择「{getCard(content, state, selectedOperatorId).name}」，请在上方点击一个空置部署位。
        </p>
      ) : null}

      <div className="phase-control">
        <div>
          <span>当前阶段</span>
          <strong>{phaseLabels[state.phase]}</strong>
        </div>
        <button
          className="game-primary-button"
          disabled={!canAct}
          onClick={() => onAdvance(active)}
          type="button"
        >
          {canAct ? phaseActionLabel(state.phase) : "等待对手操作"}
        </button>
      </div>

      <section className="game-log" aria-labelledby="log-heading">
        <h3 id="log-heading">公开行动日志</h3>
        <ol>
          {[...state.log].reverse().slice(0, 10).map((entry) => (
            <li key={entry.id}><span>#{entry.id}</span>{entry.message}</li>
          ))}
        </ol>
      </section>
    </section>
  );
}
