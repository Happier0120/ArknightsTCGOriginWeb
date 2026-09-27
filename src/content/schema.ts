import { z } from "zod";

export const factionSchema = z.enum(["rhodes_island", "reunion"]);
export const cardTypeSchema = z.enum([
  "commander",
  "operator",
  "tactical_support",
  "field",
]);

const baseCardSchema = z.object({
  id: z.string().regex(/^(RI|RM)-[COFS]\d{3}$/),
  type: cardTypeSchema,
  name: z.string().min(1),
  faction: factionSchema,
  designStatus: z.string().min(1),
  notes: z.string().optional(),
});

const commanderCardSchema = baseCardSchema.extend({
  type: z.literal("commander"),
  initialShields: z.number().int().positive(),
});

const operatorCardSchema = baseCardSchema.extend({
  type: z.literal("operator"),
  profession: z.enum([
    "先锋",
    "近卫",
    "重装",
    "特种",
    "狙击",
    "术士",
    "医疗",
    "辅助",
  ]),
  position: z.enum(["ground", "high_ground"]),
  cost: z.number().int().nonnegative(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  life: z.number().int().positive(),
  redeployCd: z.number().int().nonnegative(),
  retreatRefund: z.number().int().nonnegative(),
});

const tacticalSupportCardSchema = baseCardSchema.extend({
  type: z.literal("tactical_support"),
  supportKind: z.enum(["instant", "persistent"]),
  cost: z.number().int().nonnegative(),
});

const fieldCardSchema = baseCardSchema.extend({
  type: z.literal("field"),
  cost: z.number().int().nonnegative(),
});

export const cardDefinitionSchema = z.discriminatedUnion("type", [
  commanderCardSchema,
  operatorCardSchema,
  tacticalSupportCardSchema,
  fieldCardSchema,
]);

export const effectDefinitionSchema = z.object({
  id: z.string().regex(/^(RI|RM)-E\d{3}$/),
  cardId: z.string().min(1),
  abilityName: z.string().optional(),
  category: z.string().min(1),
  timing: z.string().min(1),
  cost: z.number().int().nonnegative().optional(),
  tap: z.enum(["yes", "no", "optional"]),
  otherCost: z.string().optional(),
  target: z.string().optional(),
  text: z.string().min(1),
  notes: z.string().optional(),
  resolution: z.string().optional(),
  usageLimit: z.string().optional(),
  duration: z.string().optional(),
});

export const deckEntrySchema = z.object({
  cardId: z.string().min(1),
  quantity: z.number().int().positive().max(3),
});

export const deckDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  faction: factionSchema,
  commanderId: z.string().min(1),
  entries: z.array(deckEntrySchema).min(1),
});

export const gameContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    cards: z.array(cardDefinitionSchema).min(1),
    effects: z.array(effectDefinitionSchema),
    decks: z.array(deckDefinitionSchema).min(1),
  })
  .superRefine((content, context) => {
    const cardsById = new Map(content.cards.map((card) => [card.id, card]));
    const uniqueCardIds = new Set(content.cards.map((card) => card.id));
    const uniqueEffectIds = new Set(content.effects.map((effect) => effect.id));
    const uniqueDeckIds = new Set(content.decks.map((deck) => deck.id));

    if (uniqueCardIds.size !== content.cards.length) {
      context.addIssue({
        code: "custom",
        message: "卡牌ID必须唯一",
        path: ["cards"],
      });
    }
    if (uniqueEffectIds.size !== content.effects.length) {
      context.addIssue({
        code: "custom",
        message: "效果ID必须唯一",
        path: ["effects"],
      });
    }
    if (uniqueDeckIds.size !== content.decks.length) {
      context.addIssue({
        code: "custom",
        message: "预组ID必须唯一",
        path: ["decks"],
      });
    }

    content.effects.forEach((effect, index) => {
      if (!cardsById.has(effect.cardId)) {
        context.addIssue({
          code: "custom",
          message: `效果引用了不存在的卡牌 ${effect.cardId}`,
          path: ["effects", index, "cardId"],
        });
      }
    });

    content.decks.forEach((deck, deckIndex) => {
      const commander = cardsById.get(deck.commanderId);
      if (commander?.type !== "commander") {
        context.addIssue({
          code: "custom",
          message: "预组必须引用一张指挥官卡",
          path: ["decks", deckIndex, "commanderId"],
        });
      } else if (commander.faction !== deck.faction) {
        context.addIssue({
          code: "custom",
          message: "指挥官阵营必须与预组一致",
          path: ["decks", deckIndex, "commanderId"],
        });
      }

      const total = deck.entries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      if (total !== 40) {
        context.addIssue({
          code: "custom",
          message: `主卡组必须为40张，当前为${total}张`,
          path: ["decks", deckIndex, "entries"],
        });
      }

      const names = new Map<string, number>();
      deck.entries.forEach((entry, entryIndex) => {
        const card = cardsById.get(entry.cardId);
        if (!card || card.type === "commander") {
          context.addIssue({
            code: "custom",
            message: `预组引用了非法主卡组卡牌 ${entry.cardId}`,
            path: ["decks", deckIndex, "entries", entryIndex],
          });
          return;
        }
        if (card.faction !== deck.faction) {
          context.addIssue({
            code: "custom",
            message: `卡牌 ${entry.cardId} 阵营与预组不符`,
            path: ["decks", deckIndex, "entries", entryIndex],
          });
        }
        names.set(card.name, (names.get(card.name) ?? 0) + entry.quantity);
      });

      names.forEach((quantity, name) => {
        if (quantity > 3) {
          context.addIssue({
            code: "custom",
            message: `同名卡「${name}」超过3张`,
            path: ["decks", deckIndex, "entries"],
          });
        }
      });
    });
  });

export type GameContent = z.infer<typeof gameContentSchema>;
export type CardDefinition = z.infer<typeof cardDefinitionSchema>;
export type EffectDefinition = z.infer<typeof effectDefinitionSchema>;
export type DeckDefinition = z.infer<typeof deckDefinitionSchema>;

