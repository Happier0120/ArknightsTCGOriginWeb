import { describe, expect, it } from "vitest";
import { gameContent } from "../../content";
import { filterDeckCards, getDeckCatalog } from "./selectors";

describe("预组目录选择器", () => {
  const rhodesDeck = gameContent.decks.find((deck) => deck.id === "RI-MVP");
  if (!rhodesDeck) throw new Error("测试数据缺少罗德岛预组");
  const catalog = getDeckCatalog(gameContent, rhodesDeck);

  it("包含16种主卡组卡牌和1张指挥官", () => {
    expect(catalog).toHaveLength(17);
    expect(catalog.filter((item) => item.isCommander)).toHaveLength(1);
    expect(
      catalog
        .filter((item) => !item.isCommander)
        .reduce((sum, item) => sum + item.quantity, 0),
    ).toBe(40);
  });

  it("将卡牌与完整效果定义关联", () => {
    const blaze = catalog.find((item) => item.card.id === "RI-O005");
    expect(blaze?.card.name).toBe("煌");
    expect(blaze?.effects).toHaveLength(2);
    expect(blaze?.effects.map((effect) => effect.abilityName)).toEqual([
      "接替突入",
      "链锯延伸",
    ]);
  });

  it("可按卡牌类型筛选", () => {
    expect(filterDeckCards(catalog, "operator")).toHaveLength(10);
    expect(filterDeckCards(catalog, "tactical_support")).toHaveLength(5);
    expect(filterDeckCards(catalog, "field")).toHaveLength(1);
  });
});

