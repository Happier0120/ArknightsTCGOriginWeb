// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gameContent } from "../../content";
import {
  createGame,
  enqueueTriggerEvent,
  saveGameSnapshot,
  type GameState,
  type PlayerId,
} from "../../game";
import { GamePrototype } from "./GamePrototype";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

async function completeMulligans(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "保留全部起手" }));
  await user.click(screen.getByRole("button", { name: "我是玩家2，已接手" }));
  await user.click(screen.getByRole("button", { name: "保留全部起手" }));
  await user.click(screen.getByRole("button", { name: "我是玩家1，已接手" }));
}

function placeOperator(
  state: GameState,
  playerId: PlayerId,
  name: string,
  slotIndex: number,
) {
  const player = state.players[playerId];
  const instanceId = [...player.hand, ...player.drawPile].find((candidateId) => {
    const definitionId = state.cardInstances[candidateId].definitionId;
    return gameContent.cards.find((card) => card.id === definitionId)?.name === name;
  });
  if (!instanceId) throw new Error(`找不到干员「${name}」`);
  player.hand = player.hand.filter((id) => id !== instanceId);
  player.drawPile = player.drawPile.filter((id) => id !== instanceId);
  const definitionId = state.cardInstances[instanceId].definitionId;
  const card = gameContent.cards.find((candidate) => candidate.id === definitionId);
  if (!card || card.type !== "operator") throw new Error(`「${name}」不是干员`);
  player.deploymentSlots[slotIndex] = {
    instanceId,
    currentLife: card.life,
    isUpright: true,
    deployedTurn: 1,
    atkModifier: 0,
    defModifier: 0,
  };
}

describe("模块2至模块6.4对局界面", () => {
  it("从手牌使用场地并在共享场地区展示控制者与完整详情入口", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-6-4-field-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;
    const fieldId = Object.values(state.cardInstances).find(
      (instance) =>
        instance.owner === "player1" && instance.definitionId === "RI-F001",
    )?.id;
    if (!fieldId) throw new Error("找不到罗德岛场地");
    state.players.player1.hand = state.players.player1.hand.filter((id) => id !== fieldId);
    state.players.player1.drawPile = state.players.player1.drawPile.filter((id) => id !== fieldId);
    state.players.player1.hand.push(fieldId);
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    expect(screen.getByRole("region", { name: "共享场地区" }).textContent).toContain(
      "当前没有场地卡",
    );
    await user.click(
      screen.getByRole("button", { name: "使用罗德岛临时救护站" }),
    );

    const fieldArea = screen.getByRole("region", { name: "共享场地区" });
    expect(fieldArea.textContent).toContain("玩家1控制");
    expect(fieldArea.textContent).toContain("罗德岛临时救护站");
    expect(screen.queryByRole("button", { name: "使用罗德岛临时救护站" })).toBeNull();
    expect(screen.getByText(/置入共享场地区/)).toBeTruthy();
  });

  it("在台面显示双方指挥官状态，并完成阿米娅的指挥官指令", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-6-3-commander-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;
    placeOperator(state, "player1", "芬", 0);
    state.players.player1.deploymentSlots[0]!.isUpright = false;
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    const ownCommander = screen.getByRole("region", { name: "玩家1指挥官区" });
    const enemyCommander = screen.getByRole("region", { name: "玩家2指挥官区" });
    expect(within(ownCommander).getByText("阿米娅")).toBeTruthy();
    expect(within(ownCommander).getByText("5/5")).toBeTruthy();
    expect(within(ownCommander).getByText("竖置")).toBeTruthy();
    expect(within(enemyCommander).getByText("塔露拉")).toBeTruthy();

    await user.click(
      within(ownCommander).getByRole("button", { name: "发动阿米娅的指挥官指令" }),
    );
    expect(screen.getByRole("heading", { name: "阿米娅 · 接续作战" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "令芬主动撤退" }));
    expect(screen.getByRole("heading", { name: "芬 · 交接阵线" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "结算能力" }));

    const updatedCommander = screen.getByRole("region", { name: "玩家1指挥官区" });
    expect(within(updatedCommander).getByText("横置")).toBeTruthy();
    expect(screen.getByText("芬")).toBeTruthy();
    expect(screen.getByText("CD 1")).toBeTruthy();
  });

  it("从部署区发动芙蓉技能并选择受伤友方目标", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-6-3-skill-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    placeOperator(state, "player1", "芙蓉", 0);
    placeOperator(state, "player1", "芬", 1);
    state.players.player1.deploymentSlots[1]!.currentLife = 1;
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    await user.click(screen.getByRole("button", { name: "发动芙蓉的基础治疗" }));
    expect(screen.getByRole("heading", { name: "芙蓉 · 基础治疗" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "选择芬作为技能目标" }));

    const board = screen.getByRole("region", { name: "玩家1部署区" });
    const fenCard = within(board).getByRole("group", { name: "查看芬详细信息" });
    const hibiscusCard = within(board).getByRole("group", { name: "查看芙蓉详细信息" });
    expect(within(fenCard).getByText("生命 2/2")).toBeTruthy();
    expect(within(hibiscusCard).getByText("横置")).toBeTruthy();
  });

  it("使用作战简报后进入抽二弃一结算页，并在弃牌后返回对局", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-6-2-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;
    const supportId = Object.values(state.cardInstances).find(
      (instance) =>
        instance.owner === "player1" && instance.definitionId === "RI-S002",
    )?.id;
    if (!supportId) throw new Error("找不到作战简报");
    state.players.player1.hand = state.players.player1.hand.filter(
      (id) => id !== supportId,
    );
    state.players.player1.drawPile = state.players.player1.drawPile.filter(
      (id) => id !== supportId,
    );
    state.players.player1.hand.push(supportId);
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    await user.click(screen.getByRole("button", { name: "使用作战简报" }));
    expect(screen.getByRole("heading", { name: "玩家1 · 作战简报" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "抽二弃一" })).toBeTruthy();
    const discardButtons = screen.getAllByRole("button", { name: /^弃置手牌/ });
    expect(discardButtons.length).toBeGreaterThan(0);
    await user.click(discardButtons[0]);
    expect(screen.getByRole("heading", { name: "玩家1 · 主要阶段" })).toBeTruthy();
    expect(screen.getByText(/弃置「/)).toBeTruthy();
  });

  it("在主要阶段使用集中火力并选择己方干员", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-6-1-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;
    placeOperator(state, "player1", "芬", 0);

    const supportId = Object.values(state.cardInstances).find(
      (instance) =>
        instance.owner === "player1" && instance.definitionId === "RI-S005",
    )?.id;
    if (!supportId) throw new Error("找不到集中火力");
    const player = state.players.player1;
    player.hand = player.hand.filter((id) => id !== supportId);
    player.drawPile = player.drawPile.filter((id) => id !== supportId);
    player.hand.push(supportId);
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    await user.click(screen.getByRole("button", { name: "选择使用集中火力" }));
    expect(
      screen.getByRole("heading", { name: "为「集中火力」选择目标" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "对芬使用集中火力" }));

    const ownBoard = screen.getByRole("region", { name: "玩家1部署区" });
    expect(within(ownBoard).getByText("4 ATK · 2 DEF")).toBeTruthy();
    expect(screen.getByText(/使用「集中火力」/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "选择使用集中火力" })).toBeNull();
  });

  it("悬停双方部署区、候场区与己方手牌时显示完整卡牌详情", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "card-hover-detail-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    placeOperator(state, "player1", "芬", 0);
    placeOperator(state, "player2", "整合运动士兵", 0);

    const migruId = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player1" && instance.definitionId === "RI-O002",
    )?.id;
    if (!migruId) throw new Error("找不到米格鲁");
    state.players.player1.hand = state.players.player1.hand.filter((id) => id !== migruId);
    state.players.player1.drawPile = state.players.player1.drawPile.filter((id) => id !== migruId);
    state.players.player1.redeployZone.push({
      instanceId: migruId,
      remainingCd: 2,
      source: "retreat",
    });

    const handCardId = state.players.player1.hand[0];
    const handCard = gameContent.cards.find(
      (card) => card.id === state.cardInstances[handCardId].definitionId,
    );
    if (!handCard) throw new Error("找不到测试手牌");
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    const ownBoard = screen.getByRole("region", { name: "玩家1部署区" });
    const enemyBoard = screen.getByRole("region", { name: "玩家2部署区" });
    const ownHand = screen.getByRole("region", { name: "玩家1手牌" });

    await user.hover(within(ownBoard).getByRole("group", { name: "查看芬详细信息" }));
    expect(screen.getByRole("tooltip").textContent).toContain("天赋");
    expect(screen.getByRole("tooltip").textContent).not.toContain("交接阵线");
    expect(screen.getByRole("tooltip").textContent).not.toContain("当前生命");
    expect(screen.getByRole("tooltip").textContent).toContain("DP2ATK2DEF2HP2");
    await user.unhover(within(ownBoard).getByRole("group", { name: "查看芬详细信息" }));

    await user.hover(
      within(enemyBoard).getByRole("group", { name: "查看整合运动士兵详细信息" }),
    );
    expect(screen.getByRole("tooltip").textContent).not.toContain("当前属性");
    expect(screen.getByRole("tooltip").textContent).toContain("整合运动士兵");
    await user.unhover(
      within(enemyBoard).getByRole("group", { name: "查看整合运动士兵详细信息" }),
    );

    await user.hover(within(ownBoard).getByRole("group", { name: "查看米格鲁详细信息" }));
    expect(screen.getByRole("tooltip").textContent).not.toContain("剩余倒计时");
    expect(screen.getByRole("tooltip").textContent).not.toContain("离场原因");
    expect(screen.getByRole("tooltip").textContent).toContain("拦截");
    await user.unhover(within(ownBoard).getByRole("group", { name: "查看米格鲁详细信息" }));

    await user.hover(
      within(ownHand).getAllByRole("group", { name: `查看${handCard.name}详细信息` })[0],
    );
    expect(screen.getByRole("tooltip").textContent).toContain(handCard.name);
    expect(screen.getByRole("tooltip").textContent).not.toContain("区域");
  });

  it("在触发队列页逐项结算必发能力后返回对局", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-5-3-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    const fenId = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player1" && instance.definitionId === "RI-O001",
    )?.id;
    if (!fenId) throw new Error("找不到芬");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_retreated",
      subjectPlayerId: "player1",
      subjectInstanceId: fenId,
      subjectDefinitionId: "RI-O001",
      subjectSlotIndex: 0,
    });
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    expect(screen.getByRole("heading", { name: "等待结算 1 项能力" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "芬 · 交接阵线" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "结算能力" }));
    expect(screen.getByRole("heading", { name: "玩家1 · 主要阶段" })).toBeTruthy();
  });

  it("触发控制者变化时先热座交接，再显示抽牌后的弃牌选择", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-5-3-handoff-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    const soldierId = Object.values(state.cardInstances).find(
      (instance) => instance.owner === "player2" && instance.definitionId === "RM-O001",
    )?.id;
    if (!soldierId) throw new Error("找不到整合运动士兵");
    enqueueTriggerEvent(state, gameContent, {
      kind: "operator_defeated",
      subjectPlayerId: "player2",
      subjectInstanceId: soldierId,
      subjectDefinitionId: "RM-O001",
      subjectSlotIndex: 0,
    });
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    expect(screen.getByRole("heading", { name: "请将设备交给玩家2" })).toBeTruthy();
    expect(screen.queryByText("当前手牌")).toBeNull();
    await user.click(screen.getByRole("button", { name: "我是玩家2，已接手" }));
    await user.click(screen.getByRole("button", { name: "发动能力" }));
    expect(screen.getByText(/已抽1张牌/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^弃置手牌/ }).length).toBeGreaterThan(0);
  });

  it("创建对局并依次保护双方调度信息", async () => {
    const user = userEvent.setup();
    render(<GamePrototype />);

    await user.click(screen.getByRole("button", { name: "洗牌并抽取起手" }));
    expect(screen.getByRole("heading", { name: "玩家1：起手调度" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^选择/ })).toHaveLength(5);

    await user.click(screen.getAllByRole("button", { name: /^选择/ })[0]);
    expect(screen.getByText("已选择 1/2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "替换1张牌" }));

    expect(screen.getByRole("heading", { name: "请将设备交给玩家2" })).toBeTruthy();
    expect(screen.queryByText("当前手牌")).toBeNull();
  });

  it("完成调度后执行先手准备与跳过抽牌", async () => {
    const user = userEvent.setup();
    render(<GamePrototype />);
    await user.click(screen.getByRole("button", { name: "洗牌并抽取起手" }));
    await completeMulligans(user);

    expect(screen.getByRole("heading", { name: "玩家1 · 准备阶段" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "执行准备阶段" }));
    expect(screen.getByText("2/2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "执行抽牌阶段" }));
    expect(screen.getByRole("heading", { name: "玩家1 · 主要阶段" })).toBeTruthy();
    expect(screen.getByText("5 张")).toBeTruthy();
    expect(screen.getByText("先手玩家跳过第一个抽牌阶段。")).toBeTruthy();
  });

  it("从本地快照恢复未完成对局", async () => {
    const user = userEvent.setup();
    const first = render(<GamePrototype />);
    await user.click(screen.getByRole("button", { name: "洗牌并抽取起手" }));
    expect(screen.getByRole("heading", { name: "玩家1：起手调度" })).toBeTruthy();
    first.unmount();

    render(<GamePrototype />);
    expect(screen.getByRole("heading", { name: "玩家1：起手调度" })).toBeTruthy();
  });

  it("在主要阶段选择手牌干员并部署到指定位置", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-3-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 1;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    state.players.player1.maxDp = 10;
    state.players.player1.availableDp = 10;

    const player = state.players.player1;
    const operatorId = [...player.hand, ...player.drawPile].find((instanceId) => {
      const definitionId = state.cardInstances[instanceId].definitionId;
      return gameContent.cards.find((card) => card.id === definitionId)?.type === "operator";
    });
    if (!operatorId) throw new Error("测试预组缺少干员");
    if (!player.hand.includes(operatorId)) {
      const drawIndex = player.drawPile.indexOf(operatorId);
      const displaced = player.hand[0];
      player.hand[0] = operatorId;
      player.drawPile[drawIndex] = displaced;
    }
    const operator = gameContent.cards.find(
      (card) => card.id === state.cardInstances[operatorId].definitionId,
    );
    if (!operator || operator.type !== "operator") throw new Error("测试干员无效");
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    const enemyBoard = screen.getByRole("region", { name: "玩家2部署区" });
    const ownBoard = screen.getByRole("region", { name: "玩家1部署区" });
    const ownHand = screen.getByRole("region", { name: "玩家1手牌" });
    expect(enemyBoard.getAttribute("data-orientation")).toBe("mirrored");
    expect(ownBoard.getAttribute("data-orientation")).toBe("normal");
    expect(
      ownBoard.compareDocumentPosition(ownHand) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      [...enemyBoard.querySelectorAll(".operator-slot > span:first-child")].map(
        (element) => element.textContent,
      ),
    ).toEqual([
      "位置 7",
      "位置 6",
      "位置 5",
      "位置 4",
      "位置 3",
      "位置 2",
      "位置 1",
    ]);
    await user.click(
      screen.getAllByRole("button", { name: `选择部署${operator.name}` })[0],
    );
    expect(screen.getByRole("status").textContent).toContain(operator.name);
    expect(screen.getAllByRole("button", { name: /^部署到位置/ })).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: "部署到位置1" }));
    expect(screen.getByText("刚部署")).toBeTruthy();
    expect(screen.queryByRole("button", { name: `撤退${operator.name}` })).toBeNull();
    expect(screen.getByText(new RegExp(`「${operator.name}」部署至位置1`))).toBeTruthy();
  });

  it("完成攻击宣告、防守交接、拦截与回合玩家交还", async () => {
    const state = createGame(gameContent, {
      player1DeckId: "RI-MVP",
      player2DeckId: "RM-MVP",
      firstPlayer: "player1",
      seed: "module-4-ui",
    });
    state.status = "playing";
    state.phase = "main";
    state.turnNumber = 3;
    state.activePlayer = "player1";
    state.currentViewer = "player1";
    placeOperator(state, "player1", "芬", 3);
    placeOperator(state, "player2", "整合运动士兵", 2);
    saveGameSnapshot(window.localStorage, state);

    const user = userEvent.setup();
    render(<GamePrototype />);
    const uprightArt = screen.getByTestId("operator-art-芬") as HTMLVideoElement;
    expect(uprightArt.loop).toBe(true);
    expect(uprightArt.getAttribute("src")).toMatch(/Vertical\.webm$/);
    await user.click(
      screen.getByRole("button", { name: "选择芬发起攻击" }),
    );
    expect(screen.getByRole("heading", { name: "选择攻击目标" })).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "攻击玩家2理智盾" }),
    );
    expect(screen.getByRole("heading", { name: "请将设备交给玩家2" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "我是玩家2，已接手" }));
    expect(screen.getByRole("heading", { name: "玩家2：是否拦截？" })).toBeTruthy();
    expect(screen.queryByText("当前手牌")).toBeNull();
    const tappedArt = screen.getByTestId("operator-art-芬") as HTMLVideoElement;
    expect(tappedArt.loop).toBe(false);
    expect(tappedArt.getAttribute("src")).toMatch(/Horizontal\.webm$/);
    await user.click(
      screen.getByRole("button", { name: "用整合运动士兵拦截" }),
    );
    expect(screen.getByRole("heading", { name: "请将设备交给玩家1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "我是玩家1，已接手" }));
    expect(screen.getByRole("heading", { name: "玩家1 · 主要阶段" })).toBeTruthy();
    expect(screen.getByText("生命 1/2")).toBeTruthy();
    expect(screen.getByText(/横置「整合运动士兵」进行拦截/)).toBeTruthy();
  });
});
