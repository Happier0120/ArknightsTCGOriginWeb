import type {
  CardDefinition,
  DeckDefinition,
  EffectDefinition,
  GameContent,
} from "../../content";

export type CardFilter = "all" | CardDefinition["type"];

export interface DeckCatalogItem {
  card: CardDefinition;
  effects: EffectDefinition[];
  isCommander: boolean;
  quantity: number;
}

export function getDeckCatalog(
  content: GameContent,
  deck: DeckDefinition,
): DeckCatalogItem[] {
  const cardsById = new Map(content.cards.map((card) => [card.id, card]));
  const effectsByCardId = new Map<string, EffectDefinition[]>();

  for (const effect of content.effects) {
    const effects = effectsByCardId.get(effect.cardId) ?? [];
    effects.push(effect);
    effectsByCardId.set(effect.cardId, effects);
  }

  const commander = cardsById.get(deck.commanderId);
  if (!commander || commander.type !== "commander") {
    throw new Error(`预组 ${deck.id} 缺少有效指挥官`);
  }

  const entries = deck.entries.map((entry) => {
    const card = cardsById.get(entry.cardId);
    if (!card) throw new Error(`预组 ${deck.id} 引用了不存在的卡牌 ${entry.cardId}`);
    return {
      card,
      effects: effectsByCardId.get(card.id) ?? [],
      isCommander: false,
      quantity: entry.quantity,
    };
  });

  return [
    {
      card: commander,
      effects: effectsByCardId.get(commander.id) ?? [],
      isCommander: true,
      quantity: 1,
    },
    ...entries,
  ];
}

export function filterDeckCards(
  cards: DeckCatalogItem[],
  filter: CardFilter,
): DeckCatalogItem[] {
  return filter === "all"
    ? cards
    : cards.filter((item) => item.card.type === filter);
}

