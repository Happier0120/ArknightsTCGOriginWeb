import { describe, expect, it } from "vitest";
import { gameContent } from "../content";

const implementedEffectIds = [
  "RI-E001",
  "RI-E002",
  "RI-E003",
  "RI-E004",
  "RI-E005",
  "RI-E006",
  "RI-E007",
  "RI-E008",
  "RI-E009",
  "RI-E010",
  "RI-E011",
  "RI-E012",
  "RI-E013",
  "RI-E014",
  "RI-E015",
  "RI-E016",
  "RI-E017",
  "RI-E018",
  "RM-E001",
  "RM-E002",
  "RM-E003",
  "RM-E004",
  "RM-E005",
  "RM-E006",
  "RM-E007",
  "RM-E008",
  "RM-E009",
  "RM-E010",
  "RM-E011",
  "RM-E012",
  "RM-E013",
  "RM-E014",
  "RM-E015",
  "RM-E016",
  "RM-E017",
] as const;

describe("模块6.4 两套预组完整效果覆盖", () => {
  it("每一个效果定义都已分配到关键词、触发、主动能力、支援或场地实现", () => {
    expect(
      gameContent.effects.map((effect) => effect.id).sort(),
    ).toEqual([...implementedEffectIds].sort());
  });

  it("两套预组中的每张卡都能在运行时数据中找到", () => {
    const definitions = new Set(gameContent.cards.map((card) => card.id));
    for (const deck of gameContent.decks) {
      expect(definitions.has(deck.commanderId)).toBe(true);
      for (const entry of deck.entries) {
        expect(definitions.has(entry.cardId)).toBe(true);
      }
    }
  });
});
