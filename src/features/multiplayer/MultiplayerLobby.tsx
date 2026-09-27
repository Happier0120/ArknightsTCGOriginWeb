import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckDefinition } from "../../content";
import type { GameCommand } from "../../game";
import { createSocketLobbyClient } from "../../multiplayer/socketClient";
import { chooseLatestGameSnapshot } from "../../multiplayer/protocol";
import type {
  LobbyClient,
  LobbyResult,
  OnlineGameSnapshot,
  RoomSession,
  RoomView,
} from "../../multiplayer/protocol";
import {
  clearRoomSession,
  loadRoomSession,
  saveRoomSession,
  type StoredRoomSession,
} from "../../multiplayer/sessionStorage";
import { OnlineGame } from "./OnlineGame";

interface MultiplayerLobbyProps {
  decks: DeckDefinition[];
  client?: LobbyClient;
}

const seatLabels = {
  player1: "玩家1",
  player2: "玩家2",
} as const;

export function MultiplayerLobby({ decks, client }: MultiplayerLobbyProps) {
  const lobbyClient = useMemo(
    () => client ?? createSocketLobbyClient(),
    [client],
  );
  const [playerName, setPlayerName] = useState("博士");
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [roomCode, setRoomCode] = useState("");
  const [session, setSession] = useState<StoredRoomSession | null>(() =>
    loadRoomSession(window.sessionStorage),
  );
  const [room, setRoom] = useState<RoomView | null>(null);
  const [gameSnapshot, setGameSnapshot] = useState<OnlineGameSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);
  const commandInFlight = useRef(false);

  useEffect(() => {
    lobbyClient.connect();
    const unsubscribe = lobbyClient.subscribe(setRoom);
    const unsubscribeGame = lobbyClient.subscribeGame((snapshot) => {
      setGameSnapshot((current) => chooseLatestGameSnapshot(current, snapshot));
    });
    const savedSession = loadRoomSession(window.sessionStorage);
    let cancelled = false;
    if (savedSession) {
      void lobbyClient.resumeRoom(savedSession.sessionToken).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setRoom(result.data);
          setError(null);
        } else {
          setError(result.error);
          if (["房间身份已经失效", "房间已经关闭"].includes(result.error)) {
            clearRoomSession(window.sessionStorage);
            setSession(null);
          }
        }
        setRestoring(false);
      });
    } else {
      setRestoring(false);
    }
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeGame();
      lobbyClient.disconnect();
    };
  }, [lobbyClient]);

  const run = async <T,>(operation: () => Promise<LobbyResult<T>>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result.data;
    } finally {
      setBusy(false);
    }
  };

  const enterSession = (nextSession: RoomSession) => {
    const storedSession = {
      playerId: nextSession.playerId,
      sessionToken: nextSession.sessionToken,
      roomCode: nextSession.room.code,
    };
    saveRoomSession(window.sessionStorage, storedSession);
    setSession(storedSession);
    setRoom(nextSession.room);
    setGameSnapshot(null);
  };

  const leaveRoom = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const result = await lobbyClient.leaveRoom(session.sessionToken);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSession(null);
      setRoom(null);
      setGameSnapshot(null);
      clearRoomSession(window.sessionStorage);
    } finally {
      setBusy(false);
    }
  };

  const dispatchGameCommand = async (command: GameCommand) => {
    if (!session || !gameSnapshot || commandInFlight.current) return;
    commandInFlight.current = true;
    try {
      const updated = await run(() =>
        lobbyClient.sendGameCommand(
          session.sessionToken,
          gameSnapshot.revision,
          command,
        ),
      );
      if (updated) {
        setGameSnapshot((current) => chooseLatestGameSnapshot(current, updated));
      }
    } finally {
      commandInFlight.current = false;
    }
  };

  const concedeGame = async () => {
    if (!session || !gameSnapshot || commandInFlight.current) return;
    commandInFlight.current = true;
    try {
      const updated = await run(() =>
        lobbyClient.concedeGame(session.sessionToken, gameSnapshot.revision),
      );
      if (updated) {
        setGameSnapshot((current) => chooseLatestGameSnapshot(current, updated));
      }
    } finally {
      commandInFlight.current = false;
    }
  };

  const retryRestore = async () => {
    if (!session) return;
    setBusy(true);
    setRestoring(true);
    setError(null);
    try {
      const result = await lobbyClient.resumeRoom(session.sessionToken);
      if (!result.ok) {
        setError(result.error);
        if (["房间身份已经失效", "房间已经关闭"].includes(result.error)) {
          clearRoomSession(window.sessionStorage);
          setSession(null);
        }
        return;
      }
      setRoom(result.data);
    } finally {
      setBusy(false);
      setRestoring(false);
    }
  };

  if (session && !room) {
    return (
      <section className="multiplayer-lobby session-recovery" aria-labelledby="recovery-heading">
        <p className="eyebrow">模块 7.3.2 · 对局恢复</p>
        <h2 id="recovery-heading">
          {restoring ? "正在恢复房间" : "暂时无法恢复房间"}
        </h2>
        <p>邀请码 {session.roomCode} · 正在重新绑定当前标签页的玩家席位。</p>
        {error ? <p className="game-error" role="alert">{error}</p> : null}
        <div className="session-recovery__actions">
          <button
            className="game-primary-button"
            disabled={busy || restoring}
            onClick={() => void retryRestore()}
            type="button"
          >
            重试恢复
          </button>
          <button
            className="text-button"
            disabled={busy || restoring}
            onClick={() => {
              clearRoomSession(window.sessionStorage);
              setSession(null);
              setError(null);
            }}
            type="button"
          >
            放弃恢复并返回大厅
          </button>
        </div>
      </section>
    );
  }

  if (!session || !room) {
    return (
      <section className="multiplayer-lobby" aria-labelledby="lobby-heading">
        <div className="game-section-heading">
          <div>
            <p className="eyebrow">模块 7.1 · 双人房间</p>
            <h2 id="lobby-heading">创建或加入对战房间</h2>
          </div>
          <p>两台设备 · 邀请码 · 实时准备状态</p>
        </div>

        {error ? <p className="game-error" role="alert">{error}</p> : null}

        <div className="lobby-profile">
          <label>
            <span>玩家名称</span>
            <input
              maxLength={16}
              onChange={(event) => setPlayerName(event.target.value)}
              value={playerName}
            />
          </label>
          <label>
            <span>使用预组</span>
            <select
              onChange={(event) => setDeckId(event.target.value)}
              value={deckId}
            >
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>{deck.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="lobby-entry-grid">
          <article>
            <span>发起对战</span>
            <h3>创建新房间</h3>
            <p>生成六位邀请码，等待另一名玩家加入。</p>
            <button
              className="game-primary-button"
              disabled={busy || !playerName.trim() || !deckId}
              onClick={async () => {
                const created = await run(() => lobbyClient.createRoom({
                  playerName: playerName.trim(),
                  deckId,
                }));
                if (created) enterSession(created);
              }}
              type="button"
            >
              创建房间
            </button>
          </article>

          <article>
            <span>接受邀请</span>
            <h3>加入已有房间</h3>
            <label>
              <span>六位邀请码</span>
              <input
                aria-label="六位邀请码"
                maxLength={6}
                onChange={(event) =>
                  setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                placeholder="例如 AB12CD"
                value={roomCode}
              />
            </label>
            <button
              className="game-primary-button"
              disabled={busy || !playerName.trim() || roomCode.length !== 6 || !deckId}
              onClick={async () => {
                const joined = await run(() => lobbyClient.joinRoom({
                  playerName: playerName.trim(),
                  deckId,
                  roomCode,
                }));
                if (joined) enterSession(joined);
              }}
              type="button"
            >
              加入房间
            </button>
          </article>
        </div>
      </section>
    );
  }

  const ownPlayer = room.players.find((player) => player.id === session.playerId);
  const canStart = Boolean(
    ownPlayer?.isHost &&
      room.players.length === 2 &&
      room.players.every((player) => player.ready && player.connected),
  );
  const opponent = room.players.find((player) => player.id !== session.playerId);

  if (
    (room.status === "started" || room.status === "finished") &&
    gameSnapshot &&
    ownPlayer &&
    opponent
  ) {
    return (
      <OnlineGame
        commandPending={busy}
        error={error}
        onCommand={dispatchGameCommand}
        onConcede={() => void concedeGame()}
        onLeave={() => void leaveRoom()}
        opponentConnected={opponent.connected}
        opponentName={opponent.name}
        playerId={ownPlayer.seat}
        playerName={ownPlayer.name}
        roomCode={room.code}
        revision={gameSnapshot.revision}
        state={gameSnapshot.state}
      />
    );
  }

  return (
    <section className="multiplayer-room" aria-labelledby="room-heading">
      <div className="room-heading">
        <div>
          <p className="eyebrow">双人对战房间</p>
          <h2 id="room-heading">邀请码 <span>{room.code}</span></h2>
        </div>
        <div className={`room-status room-status--${room.status}`}>
          {room.status === "finished"
            ? "对局已结束"
            : room.status === "started"
              ? "房间已开始"
            : room.status === "ready"
              ? "双方已准备"
              : "等待准备"}
        </div>
      </div>

      {error ? <p className="game-error" role="alert">{error}</p> : null}

      <div className="room-player-grid">
        {(["player1", "player2"] as const).map((seat) => {
          const player = room.players.find((candidate) => candidate.seat === seat);
          const isOwn = player?.id === session.playerId;
          return (
            <article className={player ? "room-player" : "room-player room-player--empty"} key={seat}>
              <div className="room-player__topline">
                <span>{seatLabels[seat]}</span>
                <span>{player?.isHost ? "房主" : player ? "挑战者" : "空席位"}</span>
              </div>
              {player ? (
                <>
                  <h3>{player.name}{isOwn ? " · 你" : ""}</h3>
                  <label>
                    <span>预组</span>
                    <select
                      aria-label={`${player.name}的预组`}
                      disabled={!isOwn || player.ready || !["waiting", "ready"].includes(room.status) || busy}
                      onChange={async (event) => {
                        if (!isOwn) return;
                        const updated = await run(() => lobbyClient.updateRoom({
                          sessionToken: session.sessionToken,
                          deckId: event.target.value,
                        }));
                        if (updated) setRoom(updated);
                      }}
                      value={player.deckId}
                    >
                      {decks.map((deck) => (
                        <option key={deck.id} value={deck.id}>{deck.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="room-player__state">
                    <span className={player.connected ? "is-online" : "is-offline"}>
                      {player.connected ? "在线" : "已断开"}
                    </span>
                    <strong>{player.ready ? "已准备" : "未准备"}</strong>
                  </div>
                  {isOwn && ["waiting", "ready"].includes(room.status) ? (
                    <button
                      className="room-ready-button"
                      disabled={busy}
                      onClick={async () => {
                        const updated = await run(() => lobbyClient.updateRoom({
                          sessionToken: session.sessionToken,
                          ready: !player.ready,
                        }));
                        if (updated) setRoom(updated);
                      }}
                      type="button"
                    >
                      {player.ready ? "取消准备" : "确认准备"}
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="room-empty-seat">
                  <strong>等待另一名玩家</strong>
                  <p>将邀请码发给对手，在另一台设备打开本页面加入。</p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {room.status === "started" ? (
        <div className="room-started-notice" role="status">
          <strong>正在创建服务器对局</strong>
          <p>正在洗牌并同步双方起手，请稍候。</p>
        </div>
      ) : (
        <div className="room-controls">
          <p>
            {room.players.length < 2
              ? "等待对手加入后，双方分别确认准备。"
              : "双方选择预组并确认准备后，由房主开始对局。"}
          </p>
          {ownPlayer?.isHost ? (
            <button
              className="game-primary-button"
              disabled={!canStart || busy}
              onClick={async () => {
                const started = await run(() =>
                  lobbyClient.startRoom(session.sessionToken),
                );
                if (started) setRoom(started);
              }}
              type="button"
            >
              开始对局
            </button>
          ) : null}
        </div>
      )}

      <button
        className="text-button room-leave-button"
        disabled={busy}
        onClick={() => void leaveRoom()}
        type="button"
      >
        离开房间
      </button>
    </section>
  );
}
