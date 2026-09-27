import type { GameState, PlayerId } from "../src/game";

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

function hiddenIds(
  playerId: PlayerId,
  zone: "hand" | "deck" | "revealed",
  count: number,
) {
  return Array.from(
    { length: count },
    (_, index) => `hidden:${playerId}:${zone}:${index + 1}`,
  );
}

function collectPublicInstanceIds(state: GameState) {
  const ids = new Set<string>();
  for (const player of Object.values(state.players)) {
    player.discardPile.forEach((id) => ids.add(id));
    player.redeployZone.forEach((entry) => ids.add(entry.instanceId));
    player.deploymentSlots.forEach((deployed) => {
      if (deployed) ids.add(deployed.instanceId);
    });
  }
  if (state.sharedField) ids.add(state.sharedField.instanceId);
  for (const effect of state.ongoingEffects) {
    ids.add(effect.sourceInstanceId);
    if ("targetInstanceId" in effect) ids.add(effect.targetInstanceId);
  }
  for (const usage of state.effectUsages) {
    if (usage.sourceInstanceId) ids.add(usage.sourceInstanceId);
  }
  for (const trigger of state.triggerQueue) {
    ids.add(trigger.sourceInstanceId);
    ids.add(trigger.event.subjectInstanceId);
    if (trigger.event.causeInstanceId) ids.add(trigger.event.causeInstanceId);
  }
  if (state.pendingTacticalSupport) {
    ids.add(state.pendingTacticalSupport.sourceInstanceId);
  }
  return ids;
}

export function createPlayerGameView(
  authoritativeState: GameState,
  viewerId: PlayerId,
): GameState {
  const view = structuredClone(authoritativeState);
  const opponentId = otherPlayer(viewerId);
  const viewer = view.players[viewerId];
  const opponent = view.players[opponentId];
  const publicIds = collectPublicInstanceIds(authoritativeState);
  const visiblePrivateIds = new Set(authoritativeState.players[viewerId].hand);
  const authoritativePending = authoritativeState.pendingTacticalSupport;
  if (authoritativePending?.controllerId === viewerId) {
    if (authoritativePending.kind === "deck_search_choice") {
      authoritativePending.revealedInstanceIds.forEach((id) => visiblePrivateIds.add(id));
    } else if (authoritativePending.kind === "deck_search_order") {
      authoritativePending.remainingInstanceIds.forEach((id) => visiblePrivateIds.add(id));
    }
  }

  opponent.hand = hiddenIds(opponentId, "hand", opponent.hand.length);
  viewer.drawPile = hiddenIds(viewerId, "deck", viewer.drawPile.length);
  opponent.drawPile = hiddenIds(opponentId, "deck", opponent.drawPile.length);
  view.seed = "server-secret";
  view.rngState = 0;

  view.cardInstances = Object.fromEntries(
    Object.entries(authoritativeState.cardInstances).filter(
      ([instanceId, instance]) =>
        visiblePrivateIds.has(instanceId) || publicIds.has(instanceId),
    ),
  );

  const pending = view.pendingTacticalSupport;
  if (pending && pending.controllerId !== viewerId) {
    if (pending.kind === "deck_search_choice") {
      pending.revealedInstanceIds = hiddenIds(
        opponentId,
        "revealed",
        pending.revealedInstanceIds.length,
      );
    } else if (pending.kind === "deck_search_order") {
      pending.remainingInstanceIds = hiddenIds(
        opponentId,
        "revealed",
        pending.remainingInstanceIds.length,
      );
    }
  }

  return view;
}
