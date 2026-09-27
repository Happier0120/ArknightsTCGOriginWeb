import type { GameContent } from "../src/content";
import {
  applyGameCommand,
  type GameCommand,
  type GameState,
} from "../src/game";
import { RoomError } from "./roomStore.mjs";

export function resolveNetworkHandoffs(
  initialState: GameState,
  content: GameContent,
): GameState {
  let state = initialState;
  for (let index = 0; index < 20; index += 1) {
    const nextTrigger = state.triggerQueue[0];
    const automaticCommand: GameCommand | null =
      state.status === "handoff" && state.handoff
        ? {
            type: "CONFIRM_HANDOFF",
            playerId: state.handoff.nextPlayer,
          }
        : nextTrigger && state.currentViewer !== nextTrigger.controllerId
          ? {
              type: "CONFIRM_TRIGGER_HANDOFF",
              playerId: nextTrigger.controllerId,
            }
          : null;
    if (!automaticCommand) return state;
    const result = applyGameCommand(state, automaticCommand, content);
    if (!result.ok) throw new RoomError(result.error);
    state = result.state;
  }
  throw new RoomError("自动交接次数异常");
}

export function applyNetworkCommand(
  state: GameState,
  command: GameCommand,
  content: GameContent,
): GameState {
  const result = applyGameCommand(state, command, content);
  if (!result.ok) throw new RoomError(result.error);
  return resolveNetworkHandoffs(result.state, content);
}
