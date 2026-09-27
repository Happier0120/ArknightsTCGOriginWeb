import { describe, expect, it } from "vitest";
import { getOperatorArt } from "./operatorArt";

describe("干员美术资源映射", () => {
  it.each(["芬", "米格鲁", "玫兰莎", "克洛丝", "安赛尔", "阿米娅"])(
    "按名字为%s匹配竖置和横置资源",
    (name) => {
      expect(getOperatorArt(name, "Vertical")).toMatch(/Vertical\.webm$/);
      expect(getOperatorArt(name, "Horizontal")).toMatch(/Horizontal\.webm$/);
    },
  );

  it("没有对应资源时返回null，由牌面使用原有样式", () => {
    expect(getOperatorArt("不存在的干员", "Vertical")).toBeNull();
  });

  it("塔露拉横置时继续使用竖置美术资源", () => {
    const vertical = getOperatorArt("塔露拉", "Vertical");
    expect(vertical).toMatch(/Vertical\.webm$/);
    expect(getOperatorArt("塔露拉", "Horizontal")).toBe(vertical);
  });
});
