import type { GameState, PlayerId } from "../src/game";
import { RoomError } from "./roomStore.mjs";

export type ForfeitReason = "concede" | "opponent_left";

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

export function finishGameByForfeit(
  authoritativeState: GameState,
  losingPlayerId: PlayerId,
  reason: ForfeitReason,
): GameState {
  if (authoritativeState.status === "finished") {
    throw new RoomError("对局已经结束");
  }
  const state = structuredClone(authoritativeState);
  const winner = otherPlayer(losingPlayerId);
  state.status = "finished";
  state.phase = "finished";
  state.winner = winner;
  state.finishReason = reason;
  state.currentViewer = winner;
  state.handoff = null;
  state.pendingAttack = null;
  state.pendingTacticalSupport = null;
  state.triggerQueue = [];
  state.triggerResumeViewer = null;
  state.log.push({
    id: state.log.length + 1,
    playerId: losingPlayerId,
    kind: reason,
    message: reason === "concede"
      ? `${losingPlayerId === "player1" ? "玩家1" : "玩家2"}认输，对手获得胜利。`
      : `${losingPlayerId === "player1" ? "玩家1" : "玩家2"}主动离开，对手获得胜利。`,
  });
  return state;
}
