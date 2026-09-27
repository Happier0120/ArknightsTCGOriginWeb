import type { GameContent } from "../content";
import { gameStateSchema, type GameState } from "./schema";

export const GAME_SNAPSHOT_KEY = "arknights-tcg.prototype.game.v10";
const LEGACY_SNAPSHOT_KEYS = [
  "arknights-tcg.prototype.game.v1",
  "arknights-tcg.prototype.game.v2",
  "arknights-tcg.prototype.game.v3",
  "arknights-tcg.prototype.game.v4",
  "arknights-tcg.prototype.game.v5",
  "arknights-tcg.prototype.game.v6",
  "arknights-tcg.prototype.game.v7",
  "arknights-tcg.prototype.game.v8",
  "arknights-tcg.prototype.game.v9",
];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveGameSnapshot(storage: StorageLike, state: GameState) {
  storage.setItem(GAME_SNAPSHOT_KEY, JSON.stringify(state));
}

export function loadGameSnapshot(
  storage: StorageLike,
  content: GameContent,
): GameState | null {
  const stored = storage.getItem(GAME_SNAPSHOT_KEY);
  if (!stored) return null;

  try {
    const state = gameStateSchema.parse(JSON.parse(stored));
    const definitionIds = new Set(content.cards.map((card) => card.id));
    if (
      Object.values(state.cardInstances).some(
        (instance) => !definitionIds.has(instance.definitionId),
      )
    ) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function clearGameSnapshot(storage: StorageLike) {
  storage.removeItem(GAME_SNAPSHOT_KEY);
  for (const key of LEGACY_SNAPSHOT_KEYS) storage.removeItem(key);
}
