import { useMemo, useState } from "react";
import { CardDetailDialog } from "./features/catalog/CardDetailDialog";
import { DeckCatalog } from "./features/catalog/DeckCatalog";
import { GamePrototype } from "./features/game/GamePrototype";
import { MultiplayerLobby } from "./features/multiplayer/MultiplayerLobby";
import {
  filterDeckCards,
  getDeckCatalog,
  type CardFilter,
} from "./features/catalog/selectors";
import { contentSummary, gameContent } from "./content";

const factionLabels = {
  rhodes_island: "罗德岛",
  reunion: "整合运动",
} as const;

export function App() {
  const [activeView, setActiveView] = useState<
    "catalog" | "game" | "multiplayer"
  >("catalog");
  const [selectedDeckId, setSelectedDeckId] = useState(
    gameContent.decks[0]?.id ?? "",
  );
  const [filter, setFilter] = useState<CardFilter>("all");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const selectedDeck =
    gameContent.decks.find((deck) => deck.id === selectedDeckId) ??
    gameContent.decks[0];

  const catalog = useMemo(
    () => (selectedDeck ? getDeckCatalog(gameContent, selectedDeck) : []),
    [selectedDeck],
  );
  const visibleCards = useMemo(
    () => filterDeckCards(catalog, filter),
    [catalog, filter],
  );
  const selectedCard = catalog.find(
    (item) => item.card.id === selectedCardId,
  );

  const selectDeck = (deckId: string) => {
    setSelectedDeckId(deckId);
    setFilter("all");
    setSelectedCardId(null);
  };

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">
          {activeView === "catalog"
            ? "模块 1 · 工程基座与卡牌数据"
            : activeView === "game"
              ? "模块 6.4 · 本地热座完整对局"
              : "模块 8.3 · 公网运行保护"}
        </p>
        <h1>明日方舟集换式卡牌</h1>
        <p className="lede">
          {activeView === "catalog"
            ? "核对两套预组与每张卡牌的结构化数据。"
            : activeView === "game"
              ? "共享场地、替换规则与在场触发现已接入，两套预组全部卡牌效果进入回归测试。"
              : "公网服务已加入消息限流、结构化日志与双快照恢复；部署后可通过同一地址完成更稳健的双人测试。"}
        </p>
      </header>

      <nav className="primary-nav" aria-label="原型功能">
        <button
          aria-pressed={activeView === "catalog"}
          onClick={() => setActiveView("catalog")}
          type="button"
        >
          卡牌浏览
        </button>
        <button
          aria-pressed={activeView === "game"}
          onClick={() => setActiveView("game")}
          type="button"
        >
          对局原型
        </button>
        <button
          aria-pressed={activeView === "multiplayer"}
          onClick={() => setActiveView("multiplayer")}
          type="button"
        >
          双人对战
        </button>
      </nav>

      {activeView === "catalog" ? (
        <>
          <section className="summary" aria-label="数据概览">
            <article>
              <strong>{contentSummary.cardCount}</strong>
              <span>卡牌定义</span>
            </article>
            <article>
              <strong>{contentSummary.effectCount}</strong>
              <span>效果定义</span>
            </article>
            <article>
              <strong>{contentSummary.deckCount}</strong>
              <span>固定预组</span>
            </article>
          </section>

          <section className="decks" aria-labelledby="deck-heading">
            <div className="section-heading">
              <h2 id="deck-heading">已载入预组</h2>
              <span>schema v{gameContent.schemaVersion}</span>
            </div>
            <div className="deck-grid">
              {gameContent.decks.map((deck) => {
                const commander = gameContent.cards.find(
                  (card) => card.id === deck.commanderId,
                );
                const total = deck.entries.reduce(
                  (sum, entry) => sum + entry.quantity,
                  0,
                );

                return (
                  <article className="deck-card" key={deck.id}>
                    <div>
                      <span className={`faction faction--${deck.faction}`}>
                        {factionLabels[deck.faction]}
                      </span>
                      <h3>{deck.name}</h3>
                    </div>
                    <dl>
                      <div>
                        <dt>指挥官</dt>
                        <dd>{commander?.name ?? "未知"}</dd>
                      </div>
                      <div>
                        <dt>主卡组</dt>
                        <dd>{total} 张</dd>
                      </div>
                      <div>
                        <dt>卡名</dt>
                        <dd>{deck.entries.length} 种</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          {selectedDeck ? (
            <DeckCatalog
              catalog={catalog}
              decks={gameContent.decks}
              filter={filter}
              selectedDeck={selectedDeck}
              visibleCards={visibleCards}
              onCardSelect={setSelectedCardId}
              onDeckSelect={selectDeck}
              onFilterChange={setFilter}
            />
          ) : null}
        </>
      ) : activeView === "game" ? (
        <GamePrototype />
      ) : (
        <MultiplayerLobby decks={gameContent.decks} />
      )}

      {activeView === "catalog" && selectedCard ? (
        <CardDetailDialog
          item={selectedCard}
          onClose={() => setSelectedCardId(null)}
        />
      ) : null}
    </main>
  );
}
