import { useEffect, useState } from "react";
import { gameContent } from "../../content";
import {
  applyGameCommand,
  clearGameSnapshot,
  createGame,
  loadGameSnapshot,
  saveGameSnapshot,
  type CreateGameConfig,
  type GameCommand,
  type GameState,
  type PlayerId,
} from "../../game";
import { GameSetup } from "./GameSetup";
import { DefenseView } from "./DefenseView";
import { HandoffView } from "./HandoffView";
import { MatchView } from "./MatchView";
import { MulliganView } from "./MulliganView";
import { TacticalSupportResolutionView } from "./TacticalSupportResolutionView";
import { TriggerQueueView } from "./TriggerQueueView";

export function GamePrototype() {
  const [state, setState] = useState<GameState | null>(() =>
    loadGameSnapshot(window.localStorage, gameContent),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if ((state as { schemaVersion: number }).schemaVersion !== 10) {
      clearGameSnapshot(window.localStorage);
      setState(null);
      setError(null);
      return;
    }
    saveGameSnapshot(window.localStorage, state);
  }, [state]);

  const create = (config: CreateGameConfig) => {
    try {
      setState(createGame(gameContent, config));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建对局");
    }
  };

  const dispatch = (command: GameCommand) => {
    if (!state) return;
    const result = applyGameCommand(state, command, gameContent);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState(result.state);
    setError(null);
  };

  const reset = () => {
    clearGameSnapshot(window.localStorage);
    setState(null);
    setError(null);
  };

  return (
    <div className="game-prototype">
      {error ? <p className="game-error" role="alert">{error}</p> : null}
      {!state ? <GameSetup decks={gameContent.decks} onCreate={create} /> : null}
      {state?.pendingTacticalSupport ? (
        <TacticalSupportResolutionView
          content={gameContent}
          onReset={reset}
          onResolve={(playerId, action) =>
            dispatch({ type: "RESOLVE_TACTICAL_SUPPORT", playerId, action })
          }
          state={state}
        />
      ) : null}
      {state && !state.pendingTacticalSupport && state.triggerQueue.length > 0 ? (
        <TriggerQueueView
          content={gameContent}
          onConfirmHandoff={(playerId) =>
            dispatch({ type: "CONFIRM_TRIGGER_HANDOFF", playerId })
          }
          onResolve={(playerId, triggerId, action, target, discardInstanceId) =>
            dispatch({
              type: "RESOLVE_TRIGGER",
              playerId,
              triggerId,
              action,
              target,
              discardInstanceId,
            })
          }
          onReset={reset}
          state={state}
        />
      ) : null}
      {state?.pendingTacticalSupport === null && state.triggerQueue.length === 0 && state.status === "mulligan" ? (
        <MulliganView
          content={gameContent}
          key={`${state.currentViewer}-${state.log.length}`}
          onSubmit={(cardInstanceIds) =>
            dispatch({
              type: "SUBMIT_MULLIGAN",
              playerId: state.currentViewer,
              cardInstanceIds,
            })
          }
          playerId={state.currentViewer}
          state={state}
        />
      ) : null}
      {state?.pendingTacticalSupport === null && state.triggerQueue.length === 0 && state.status === "handoff" ? (
        <HandoffView
          onConfirm={(playerId) =>
            dispatch({ type: "CONFIRM_HANDOFF", playerId })
          }
          state={state}
        />
      ) : null}
      {state?.pendingTacticalSupport === null && state.triggerQueue.length === 0 && state.status === "defending" ? (
        <DefenseView
          content={gameContent}
          onResolve={(playerId, interceptSlotIndex) =>
            dispatch({
              type: "RESOLVE_ATTACK",
              playerId,
              interceptSlotIndex,
            })
          }
          state={state}
        />
      ) : null}
      {state && state.pendingTacticalSupport === null && state.triggerQueue.length === 0 && (state.status === "playing" || state.status === "finished") ? (
        <MatchView
          content={gameContent}
          onActivateAbility={(playerId, source, target) =>
            dispatch({
              type: "ACTIVATE_ABILITY",
              playerId,
              source,
              target,
            })
          }
          onAdvance={(playerId) =>
            dispatch({ type: "ADVANCE_PHASE", playerId })
          }
          onDeploy={(playerId, cardInstanceId, slotIndex) =>
            dispatch({
              type: "DEPLOY_OPERATOR",
              playerId,
              cardInstanceId,
              slotIndex,
            })
          }
          onDeclareAttack={(playerId, attackerSlotIndex, target) =>
            dispatch({
              type: "DECLARE_ATTACK",
              playerId,
              attackerSlotIndex,
              target,
            })
          }
          onPlayTacticalSupport={(playerId, cardInstanceId, target) =>
            dispatch({
              type: "PLAY_TACTICAL_SUPPORT",
              playerId,
              cardInstanceId,
              target,
            })
          }
          onPlayField={(playerId, cardInstanceId) =>
            dispatch({
              type: "PLAY_FIELD",
              playerId,
              cardInstanceId,
            })
          }
          onRetreat={(playerId, slotIndex) =>
            dispatch({ type: "RETREAT_OPERATOR", playerId, slotIndex })
          }
          onReset={reset}
          state={state}
        />
      ) : null}
    </div>
  );
}
