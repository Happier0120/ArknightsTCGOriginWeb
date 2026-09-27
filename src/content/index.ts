import contentData from "./generated/content.json";
import { gameContentSchema } from "./schema";

export const gameContent = gameContentSchema.parse(contentData);

export const contentSummary = Object.freeze({
  cardCount: gameContent.cards.length,
  effectCount: gameContent.effects.length,
  deckCount: gameContent.decks.length,
});

export type {
  CardDefinition,
  DeckDefinition,
  EffectDefinition,
  GameContent,
} from "./schema";

