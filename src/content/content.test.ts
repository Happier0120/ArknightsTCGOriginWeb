import { describe, expect, it } from "vitest";
import { gameContent } from ".";
import { gameContentSchema } from "./schema";

describe("首测卡牌数据", () => {
  it("载入两套40张预组", () => {
    expect(gameContent.decks).toHaveLength(2);
    for (const deck of gameContent.decks) {
      const total = deck.entries.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      expect(total).toBe(40);
      expect(deck.entries).toHaveLength(16);
    }
  });

  it("载入当前全部卡牌和效果定义", () => {
    expect(gameContent.cards).toHaveLength(34);
    expect(gameContent.effects).toHaveLength(35);
  });

  it("所有效果都引用存在的卡牌", () => {
    const cardIds = new Set(gameContent.cards.map((card) => card.id));
    for (const effect of gameContent.effects) {
      expect(cardIds.has(effect.cardId), effect.id).toBe(true);
    }
  });

  it("每个阵营都有一个指挥官和一套预组", () => {
    for (const faction of ["rhodes_island", "reunion"] as const) {
      expect(
        gameContent.cards.filter(
          (card) => card.faction === faction && card.type === "commander",
        ),
      ).toHaveLength(1);
      expect(
        gameContent.decks.filter((deck) => deck.faction === faction),
      ).toHaveLength(1);
    }
  });

  it("拒绝不是40张的主卡组", () => {
    const invalid = structuredClone(gameContent);
    invalid.decks[0].entries[0].quantity = 2;

    const result = gameContentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("40张"))).toBe(
        true,
      );
    }
  });

  it("拒绝重复卡牌ID", () => {
    const invalid = structuredClone(gameContent);
    invalid.cards.push(structuredClone(invalid.cards[0]));

    const result = gameContentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("ID必须唯一"))).toBe(
        true,
      );
    }
  });

  it("拒绝引用不存在卡牌的效果", () => {
    const invalid = structuredClone(gameContent);
    invalid.effects[0].cardId = "MISSING-CARD";

    const result = gameContentSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message.includes("不存在的卡牌")),
      ).toBe(true);
    }
  });
});
