import { useState } from "react";
import { gameContent } from "../../content";
import type { GameCommand, GameState, PlayerId } from "../../game";
import { DefenseView } from "../game/DefenseView";
import { MatchView } from "../game/MatchView";
import { MulliganView } from "../game/MulliganView";
import { TacticalSupportResolutionView } from "../game/TacticalSupportResolutionView";
import { TriggerQueueView } from "../game/TriggerQueueView";
import { playerLabels } from "../game/gameUi";

interface OnlineGameProps {
  state: GameState;
  playerId: PlayerId;
  roomCode: string;
  playerName: string;
  opponentName: string;
  opponentConnected: boolean;
  revision: number;
  commandPending: boolean;
  error?: string | null;
  onCommand: (command: GameCommand) => void;
  onConcede: () => void;
  onLeave: () => void;
}

function WaitingForPlayer({
  state,
  playerId,
  message,
}: {
  state: GameState;
  playerId: PlayerId;
  message: string;
}) {
  return (
    <section className="online-waiting" aria-live="polite">
      <p className="eyebrow">服务器权威对局</p>
      <h2>{message}</h2>
      <p>
        你是{playerLabels[playerId]}。对手完成操作后，页面会自动同步最新状态。
      </p>
      <div>
        <span>当前阶段</span>
        <strong>{state.status === "mulligan" ? "秘密调度" : state.status === "defending" ? "防守响应" : "能力结算"}</strong>
      </div>
    </section>
  );
}

export function OnlineGame({
  state,
  playerId,
  roomCode,
  playerName,
  opponentName,
  opponentConnected,
  revision,
  commandPending,
  error,
  onCommand,
  onConcede,
  onLeave,
}: OnlineGameProps) {
  const [confirmingConcede, setConfirmingConcede] = useState(false);
  const currentTrigger = state.triggerQueue[0];
  const pendingSupport = state.pendingTacticalSupport;

  let content;
  if (state.status === "finished") {
    const isDraw = state.winner === null;
    const didWin = state.winner === playerId;
    const resultReason = state.finishReason === "deck_out"
      ? "败方在必须抽牌时牌库为空。"
      : state.finishReason === "shields_depleted"
        ? "败方的最后一个理智盾已被击破。"
        : state.finishReason === "concede"
          ? didWin
            ? `${opponentName}选择认输。`
            : "你选择了认输。"
          : state.finishReason === "opponent_left"
            ? didWin
              ? `${opponentName}主动离开了对局。`
              : "你已主动离开对局。"
            : "对局已经结束。";
    content = (
      <section
        className={`online-result online-result--${isDraw ? "draw" : didWin ? "victory" : "defeat"}`}
        aria-labelledby="online-result-heading"
      >
        <p className="eyebrow">对局结算</p>
        <h2 id="online-result-heading">
          {isDraw ? "本局平局" : didWin ? "你获得胜利" : "本局落败"}
        </h2>
        <p>{resultReason}</p>
        <strong>
          {isDraw ? "本局没有胜者" : `胜者：${didWin ? playerName : opponentName}`}
        </strong>
        <button className="game-primary-button" onClick={onLeave} type="button">
          返回对战大厅
        </button>
      </section>
    );
  } else if (pendingSupport) {
    content = pendingSupport.controllerId === playerId ? (
      <TacticalSupportResolutionView
        content={gameContent}
        hideReset
        onReset={onConcede}
        onResolve={(actor, action) =>
          onCommand({ type: "RESOLVE_TACTICAL_SUPPORT", playerId: actor, action })
        }
        resetLabel="认输"
        state={state}
      />
    ) : (
      <WaitingForPlayer message="等待对手完成战术支援结算" playerId={playerId} state={state} />
    );
  } else if (currentTrigger) {
    content = currentTrigger.controllerId === playerId ? (
      <TriggerQueueView
        content={gameContent}
        hideReset
        onConfirmHandoff={(actor) =>
          onCommand({ type: "CONFIRM_TRIGGER_HANDOFF", playerId: actor })
        }
        onReset={onConcede}
        onResolve={(actor, triggerId, action, target, discardInstanceId) =>
          onCommand({
            type: "RESOLVE_TRIGGER",
            playerId: actor,
            triggerId,
            action,
            target,
            discardInstanceId,
          })
        }
        resetLabel="认输"
        state={state}
      />
    ) : (
      <WaitingForPlayer message="等待对手结算触发能力" playerId={playerId} state={state} />
    );
  } else if (state.status === "mulligan") {
    content = state.currentViewer === playerId ? (
      <MulliganView
        content={gameContent}
        key={`${playerId}-${state.log.length}`}
        onSubmit={(cardInstanceIds) =>
          onCommand({ type: "SUBMIT_MULLIGAN", playerId, cardInstanceIds })
        }
        playerId={playerId}
        state={state}
      />
    ) : (
      <WaitingForPlayer message="等待对手完成起手调度" playerId={playerId} state={state} />
    );
  } else if (state.status === "defending") {
    content = state.pendingAttack?.defenderPlayerId === playerId ? (
      <DefenseView
        content={gameContent}
        onResolve={(actor, interceptSlotIndex) =>
          onCommand({ type: "RESOLVE_ATTACK", playerId: actor, interceptSlotIndex })
        }
        state={state}
      />
    ) : (
      <WaitingForPlayer message="等待对手选择是否拦截" playerId={playerId} state={state} />
    );
  } else if (state.status === "playing") {
    content = (
      <MatchView
        content={gameContent}
        hideReset
        onActivateAbility={(actor, source, target) =>
          onCommand({ type: "ACTIVATE_ABILITY", playerId: actor, source, target })
        }
        onAdvance={(actor) => onCommand({ type: "ADVANCE_PHASE", playerId: actor })}
        onDeclareAttack={(actor, attackerSlotIndex, target) =>
          onCommand({ type: "DECLARE_ATTACK", playerId: actor, attackerSlotIndex, target })
        }
        onDeploy={(actor, cardInstanceId, slotIndex) =>
          onCommand({ type: "DEPLOY_OPERATOR", playerId: actor, cardInstanceId, slotIndex })
        }
        onPlayField={(actor, cardInstanceId) =>
          onCommand({ type: "PLAY_FIELD", playerId: actor, cardInstanceId })
        }
        onPlayTacticalSupport={(actor, cardInstanceId, target) =>
          onCommand({ type: "PLAY_TACTICAL_SUPPORT", playerId: actor, cardInstanceId, target })
        }
        onReset={onConcede}
        onRetreat={(actor, slotIndex) =>
          onCommand({ type: "RETREAT_OPERATOR", playerId: actor, slotIndex })
        }
        state={state}
        viewerId={playerId}
        resetLabel="认输"
      />
    );
  } else {
    content = <WaitingForPlayer message="正在同步对局状态" playerId={playerId} state={state} />;
  }

  return (
    <section
      aria-busy={commandPending}
      className="online-game"
      aria-label="联网对局"
    >
      <header className="online-game__banner">
        <div>
          <span>房间 {roomCode} · {playerLabels[playerId]}</span>
          <strong>{playerName} 对战 {opponentName}</strong>
        </div>
        <div className="online-game__status">
          <span className={opponentConnected ? "is-online" : "is-offline"}>
            ● {opponentConnected ? "实时同步" : "对手已断开"}
          </span>
          <span className="online-game__revision">
            同步 r{revision}{commandPending ? " · 正在提交" : ""}
          </span>
          {state.status !== "finished" ? (
            confirmingConcede ? (
              <span className="online-game__concede-confirm">
                <button
                  className="danger-button"
                  disabled={commandPending}
                  onClick={() => {
                    setConfirmingConcede(false);
                    onConcede();
                  }}
                  type="button"
                >
                  确认认输
                </button>
                <button
                  className="text-button"
                  onClick={() => setConfirmingConcede(false)}
                  type="button"
                >
                  取消
                </button>
              </span>
            ) : (
              <button
                className="text-button"
                disabled={commandPending}
                onClick={() => setConfirmingConcede(true)}
                type="button"
              >
                认输
              </button>
            )
          ) : null}
        </div>
      </header>
      {error ? <p className="game-error" role="alert">{error}</p> : null}
      {content}
    </section>
  );
}
