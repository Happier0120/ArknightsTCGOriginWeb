// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

afterEach(cleanup);

describe("预组与卡牌详情页面", () => {
  it("展示当前预组的全部卡牌定义", () => {
    render(<App />);
    expect(screen.getByLabelText("查看指挥官阿米娅详情")).toBeTruthy();
    expect(screen.getByLabelText("查看干员阿米娅详情")).toBeTruthy();
    expect(screen.getByLabelText("查看干员芬详情")).toBeTruthy();
    expect(screen.getByLabelText("查看场地罗德岛临时救护站详情")).toBeTruthy();
  });

  it("在预组牌面显示干员Vertical美术和完整卡牌效果", () => {
    render(<App />);
    const fen = screen.getByLabelText("查看干员芬详情");
    const art = screen.getByTestId("catalog-art-芬");

    expect(art.getAttribute("src")).toMatch(/Vertical\.webm$/);
    expect(fen.textContent).toContain("天赋");
    expect(fen.textContent).not.toContain("交接阵线");
    expect(fen.textContent).toContain(
      "当芬主动撤退时，本回合你下一次部署的罗德岛地面干员获得【拦截】",
    );
    expect(fen.textContent).toContain("撤退返费 1 · CD 2");
  });

  it("为单能力、双能力和无能力干员使用统一的规则框", () => {
    render(<App />);
    const cards = ["芬", "玫兰莎", "煌"].map((name) =>
      screen.getByLabelText(`查看干员${name}详情`),
    );

    expect(cards.map((card) => card.querySelector(".operator-card__rules"))).toHaveLength(
      3,
    );
    expect(cards[0].textContent).not.toContain("项能力");
    expect(cards[1].textContent).not.toContain("无额外能力");
    expect(cards[2].textContent).not.toContain("项能力");
    expect(cards[2].textContent).not.toContain("链锯延伸");
    expect(cards[2].textContent).toContain("天赋");
  });

  it("按类型筛选并切换预组", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^战术支援/ }));
    expect(screen.queryByLabelText("查看干员芬详情")).toBeNull();
    expect(screen.getByLabelText("查看战术支援人员调度详情")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "整合运动" }));
    expect(screen.getByLabelText("查看干员整合运动士兵详情")).toBeTruthy();
    expect(screen.queryByLabelText("查看战术支援人员调度详情")).toBeNull();
  });

  it("打开详情并支持Escape关闭", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText("查看干员芬详情"));
    const dialog = screen.getByRole("dialog", { name: "芬" });
    expect(dialog.textContent).toContain("卡牌规则");
    expect(dialog.textContent).toContain("天赋");
    expect(dialog.textContent).not.toContain("交接阵线");
    expect(dialog.textContent).toContain("再部署 CD");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
