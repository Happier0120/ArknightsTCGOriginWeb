import type { DeckDefinition } from "../../content";
import { getOperatorArt } from "../../art/operatorArt";
import type { CardFilter, DeckCatalogItem } from "./selectors";

const factionLabels = {
  rhodes_island: "罗德岛",
  reunion: "整合运动",
} as const;

const typeLabels = {
  commander: "指挥官",
  operator: "干员",
  tactical_support: "战术支援",
  field: "场地",
} as const;

const filters: Array<{ id: CardFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "operator", label: "干员" },
  { id: "tactical_support", label: "战术支援" },
  { id: "field", label: "场地" },
];

function OperatorCatalogCard({ item }: { item: DeckCatalogItem }) {
  const { card } = item;
  if (card.type !== "operator") return null;
  const artUrl = getOperatorArt(card.name, "Vertical");

  return (
    <>
      <div
        className={`operator-card__artwork${artUrl ? "" : " operator-card__artwork--placeholder"}`}
      >
        {artUrl ? (
          <video
            aria-hidden="true"
            autoPlay
            className="operator-card__art"
            data-testid={`catalog-art-${card.name}`}
            loop
            muted
            playsInline
            preload="metadata"
            src={artUrl}
          />
        ) : (
          <span className="operator-card__placeholder-name">{card.name}</span>
        )}
        <div className="operator-card__art-overlay">
          <div className="operator-card__topline">
            <span>{card.position === "ground" ? "地面" : "高台"}</span>
            <strong>×{item.quantity}</strong>
          </div>
          <div className="operator-card__identity">
            <span>{card.profession}</span>
            <h3>{card.name}</h3>
          </div>
          <dl className="operator-card__stats">
            <div>
              <dt>DP</dt>
              <dd>{card.cost}</dd>
            </div>
            <div>
              <dt>ATK</dt>
              <dd>{card.atk}</dd>
            </div>
            <div>
              <dt>DEF</dt>
              <dd>{card.def}</dd>
            </div>
            <div>
              <dt>HP</dt>
              <dd>{card.life}</dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="operator-card__rules">
        <div className="operator-card__rules-heading">
          <span>
            {item.effects.length > 0
              ? `${item.effects.length} 项能力`
              : "卡牌能力"}
          </span>
          <small>撤退返费 {card.retreatRefund} · CD {card.redeployCd}</small>
        </div>
        {item.effects.length > 0 ? (
          <div
            className={`operator-card__effects${item.effects.length > 1 ? " operator-card__effects--multiple" : ""}`}
          >
            {item.effects.map((effect) => (
              <section key={effect.id}>
                <strong>{effect.abilityName ?? effect.category}</strong>
                <p>{effect.text}</p>
              </section>
            ))}
          </div>
        ) : (
          <p className="operator-card__no-effect">无额外能力</p>
        )}
        <span className="operator-card__detail-hint">点击查看完整资料</span>
      </div>
    </>
  );
}

interface DeckCatalogProps {
  catalog: DeckCatalogItem[];
  decks: DeckDefinition[];
  filter: CardFilter;
  selectedDeck: DeckDefinition;
  visibleCards: DeckCatalogItem[];
  onCardSelect: (cardId: string) => void;
  onDeckSelect: (deckId: string) => void;
  onFilterChange: (filter: CardFilter) => void;
}

function getCardSubtitle(item: DeckCatalogItem) {
  const { card } = item;
  if (card.type === "operator") {
    return `${card.profession} · ${card.position === "ground" ? "地面" : "高台"}`;
  }
  if (card.type === "tactical_support") {
    return card.supportKind === "instant" ? "即时型" : "持续型";
  }
  if (card.type === "commander") return `${card.initialShields} 点初始理智盾`;
  return "共享场地";
}

export function DeckCatalog({
  catalog,
  decks,
  filter,
  selectedDeck,
  visibleCards,
  onCardSelect,
  onDeckSelect,
  onFilterChange,
}: DeckCatalogProps) {
  const counts = new Map<CardFilter, number>([
    ["all", catalog.length],
    ["commander", catalog.filter((item) => item.card.type === "commander").length],
    ["operator", catalog.filter((item) => item.card.type === "operator").length],
    [
      "tactical_support",
      catalog.filter((item) => item.card.type === "tactical_support").length,
    ],
    ["field", catalog.filter((item) => item.card.type === "field").length],
  ]);

  return (
    <section className="catalog" aria-labelledby="catalog-heading">
      <div className="catalog-header">
        <div>
          <p className="eyebrow">预组浏览</p>
          <h2 id="catalog-heading">逐张核对卡牌数据</h2>
        </div>
        <div className="deck-switcher" aria-label="选择预组">
          {decks.map((deck) => (
            <button
              aria-pressed={deck.id === selectedDeck.id}
              className="switch-button"
              key={deck.id}
              onClick={() => onDeckSelect(deck.id)}
              type="button"
            >
              {factionLabels[deck.faction]}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-toolbar">
        <div className="filter-group" aria-label="按卡牌类型筛选">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.id}
              className="filter-button"
              key={item.id}
              onClick={() => onFilterChange(item.id)}
              type="button"
            >
              {item.label}
              <span>{counts.get(item.id)}</span>
            </button>
          ))}
        </div>
        <p>
          {selectedDeck.name} · 40 张主卡组 + 1 张指挥官
        </p>
      </div>

      <div className="card-grid">
        {visibleCards.map((item) => {
          const { card } = item;
          const isOperator = card.type === "operator";
          return (
            <button
              aria-label={`查看${typeLabels[card.type]}${card.name}详情`}
              className={`card-tile card-tile--${card.faction}${isOperator ? " card-tile--operator" : ""}`}
              key={card.id}
              onClick={() => onCardSelect(card.id)}
              type="button"
            >
              {isOperator ? (
                <OperatorCatalogCard item={item} />
              ) : (
                <>
                  <div className="card-tile__topline">
                    <span>{typeLabels[card.type]}</span>
                    <strong>{item.isCommander ? "指挥官" : `×${item.quantity}`}</strong>
                  </div>
                  <div className="card-tile__body">
                    <h3>{card.name}</h3>
                    <p>{getCardSubtitle(item)}</p>
                  </div>
                  <div className="card-tile__footer">
                    {"cost" in card ? <span>{card.cost} DP</span> : <span>—</span>}
                    <span>{item.effects.length} 项能力</span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
