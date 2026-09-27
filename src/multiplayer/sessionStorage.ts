export const ROOM_SESSION_KEY = "atcg.multiplayer.room-session.v1";

export interface StoredRoomSession {
  playerId: string;
  sessionToken: string;
  roomCode: string;
}

function isStoredRoomSession(value: unknown): value is StoredRoomSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.playerId === "string" && candidate.playerId.length > 0 &&
    typeof candidate.sessionToken === "string" && candidate.sessionToken.length > 0 &&
    typeof candidate.roomCode === "string" && /^[A-Z0-9]{6}$/.test(candidate.roomCode)
  );
}

export function loadRoomSession(storage: Storage): StoredRoomSession | null {
  try {
    const raw = storage.getItem(ROOM_SESSION_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isStoredRoomSession(value)) {
      storage.removeItem(ROOM_SESSION_KEY);
      return null;
    }
    return value;
  } catch {
    storage.removeItem(ROOM_SESSION_KEY);
    return null;
  }
}

export function saveRoomSession(
  storage: Storage,
  session: StoredRoomSession,
) {
  storage.setItem(ROOM_SESSION_KEY, JSON.stringify(session));
}

export function clearRoomSession(storage: Storage) {
  storage.removeItem(ROOM_SESSION_KEY);
}
