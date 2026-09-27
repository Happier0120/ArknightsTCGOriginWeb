import { useState, type FormEvent } from "react";
import type { DeckDefinition } from "../../content";
import type { CreateGameConfig, PlayerId } from "../../game";

interface GameSetupProps {
  decks: DeckDefinition[];
  onCreate: (config: CreateGameConfig) => void;
}

export function GameSetup({ decks, onCreate }: GameSetupProps) {
  const [player1DeckId, setPlayer1DeckId] = useState(decks[0]?.id ?? "");
  const [player2DeckId, setPlayer2DeckId] = useState(decks[1]?.id ?? decks[0]?.id ?? "");
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>("player1");
  const [seed, setSeed] = useState("module-6-4-69");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onCreate({ player1DeckId, player2DeckId, firstPlayer, seed });
  };

  return (
    <section className="game-setup" aria-labelledby="setup-heading">
      <div className="game-section-heading">
        <div>
          <p className="eyebrow">测试对局 · 初始化</p>
          <h2 id="setup-heading">创建测试对局</h2>
        </div>
        <p>固定预组 · 本地热座 · 自动保存</p>
      </div>

      <form onSubmit={submit}>
        <div className="setup-grid">
          <label>
            <span>玩家1预组</span>
            <select
              value={player1DeckId}
              onChange={(event) => setPlayer1DeckId(event.target.value)}
            >
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>玩家2预组</span>
            <select
              value={player2DeckId}
              onChange={(event) => setPlayer2DeckId(event.target.value)}
            >
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
          <label className="seed-field">
            <span>随机种子</span>
            <input
              required
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
            <small>相同种子与操作会得到相同牌序；默认种子便于验收模块 6.4。</small>
          </label>
        </div>

        <fieldset>
          <legend>先手玩家</legend>
          {(["player1", "player2"] as const).map((playerId) => (
            <label className="radio-option" key={playerId}>
              <input
                checked={firstPlayer === playerId}
                name="first-player"
                onChange={() => setFirstPlayer(playerId)}
                type="radio"
              />
              {playerId === "player1" ? "玩家1" : "玩家2"}
            </label>
          ))}
        </fieldset>

        <button className="game-primary-button" type="submit">
          洗牌并抽取起手
        </button>
      </form>
    </section>
  );
}
