import type { DeckDefinition, GameContent } from "../content";
import {
  getCurrentOperatorStats,
  getOperatorDefinition,
  moveDefeatedOperator,
} from "./operators";
import {
  addOngoingEffect,
  canUseEffect,
  consumeDeploymentCostModifiers,
  consumeNextDeploymentEffects,
  expireOngoingEffects,
  getDeploymentCostModifier,
  hasAttackPermission,
  hasGrantedKeyword,
  recordEffectUsage,
  removeAttachedEffects,
} from "./ongoingEffects";
import { hashSeed, shuffle } from "./random";
import { activateAbility } from "./activeAbilities";
import { enqueueTriggerEvent } from "./triggers";
import { confirmTriggerHandoff, resolveTrigger } from "./triggerResolution";
import type {
  CommandResult,
  AttackTarget,
  CreateGameConfig,
  GameCommand,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  TacticalSupportTarget,
  TriggerEventSnapshot,
} from "./schema";

const otherPlayer = (playerId: PlayerId): PlayerId =>
  playerId === "player1" ? "player2" : "player1";

function fail(state: GameState, error: string): CommandResult {
  return { ok: false, state, error, events: [] };
}

function appendEvents(state: GameState, events: GameEvent[]) {
  for (const event of events) {
    state.log.push({
      id: state.log.length + 1,
      ...event,
    });
  }
}

function success(
  state: GameState,
  events: GameEvent[],
  content?: GameContent,
  triggerEvents: TriggerEventSnapshot[] = [],
): CommandResult {
  appendEvents(state, events);
  const queueEvents = content
    ? triggerEvents.flatMap((event) => enqueueTriggerEvent(state, content, event))
    : [];
  appendEvents(state, queueEvents);
  return { ok: true, state, events: [...events, ...queueEvents] };
}

function findDeck(content: GameContent, deckId: string): DeckDefinition {
  const deck = content.decks.find((candidate) => candidate.id === deckId);
  if (!deck) throw new Error(`不存在的预组：${deckId}`);
  return deck;
}

function createPlayer(
  content: GameContent,
  playerId: PlayerId,
  deckId: string,
  rngState: number,
): {
  player: PlayerState;
  instances: GameState["cardInstances"];
  rngState: number;
} {
  const deck = findDeck(content, deckId);
  const commander = content.cards.find((card) => card.id === deck.commanderId);
  if (!commander || commander.type !== "commander") {
    throw new Error(`预组 ${deckId} 缺少有效指挥官`);
  }

  const definitions = deck.entries.flatMap((entry) =>
    Array.from({ length: entry.quantity }, () => entry.cardId),
  );
  const instances = Object.fromEntries(
    definitions.map((definitionId, index) => {
      const id = `${playerId}-card-${String(index + 1).padStart(2, "0")}`;
      return [id, { id, definitionId, owner: playerId }];
    }),
  );
  const shuffled = shuffle(Object.keys(instances), rngState);
  const hand = shuffled.items.slice(0, 5);
  const drawPile = shuffled.items.slice(5);

  return {
    player: {
      id: playerId,
      deckId,
      commanderId: deck.commanderId,
      commanderIsUpright: true,
      drawPile,
      hand,
      discardPile: [],
      deploymentSlots: Array.from({ length: 7 }, () => null),
      deploymentCapacity: 7,
      redeployZone: [],
      shields: commander.initialShields,
      maxDp: 0,
      availableDp: 0,
      mulliganCompleted: false,
      turnsStarted: 0,
    },
    instances,
    rngState: shuffled.state,
  };
}

export function createGame(
  content: GameContent,
  config: CreateGameConfig,
): GameState {
  const seed = config.seed.trim();
  if (!seed) throw new Error("随机种子不能为空");

  let rngState = hashSeed(seed);
  const player1 = createPlayer(
    content,
    "player1",
    config.player1DeckId,
    rngState,
  );
  rngState = player1.rngState;
  const player2 = createPlayer(
    content,
    "player2",
    config.player2DeckId,
    rngState,
  );

  return {
    schemaVersion: 10,
    gameId: `game-${hashSeed(`${seed}:${config.player1DeckId}:${config.player2DeckId}`)
      .toString(16)
      .padStart(8, "0")}`,
    seed,
    rngState: player2.rngState,
    status: "mulligan",
    phase: "setup",
    turnNumber: 0,
    firstPlayer: config.firstPlayer,
    activePlayer: config.firstPlayer,
    currentViewer: "player1",
    players: {
      player1: player1.player,
      player2: player2.player,
    },
    cardInstances: {
      ...player1.instances,
      ...player2.instances,
    },
    handoff: null,
    pendingAttack: null,
    triggerQueue: [],
    nextTriggerId: 1,
    nextTriggerBatchId: 1,
    triggerResumeViewer: null,
    pendingTacticalSupport: null,
    sharedField: null,
    ongoingEffects: [],
    nextOngoingEffectId: 1,
    effectUsages: [],
    turnFacts: {
      turnNumber: 0,
      player1: { retreatedOperatorIds: [], defeatedOperatorIds: [] },
      player2: { retreatedOperatorIds: [], defeatedOperatorIds: [] },
    },
    winner: null,
    finishReason: null,
    log: [
      {
        id: 1,
        kind: "game_created",
        message: `对局已创建，${config.firstPlayer === "player1" ? "玩家1" : "玩家2"}先手。`,
      },
    ],
  };
}

function submitMulligan(
  state: GameState,
  playerId: PlayerId,
  selectedIds: string[],
): CommandResult {
  if (state.status !== "mulligan" || state.currentViewer !== playerId) {
    return fail(state, "当前不能由该玩家进行调度");
  }
  const player = state.players[playerId];
  if (player.mulliganCompleted) return fail(state, "该玩家已经完成调度");

  const uniqueIds = new Set(selectedIds);
  if (uniqueIds.size !== selectedIds.length) return fail(state, "调度卡牌不能重复");
  if (selectedIds.length > 2) return fail(state, "调度最多选择2张牌");
  if (selectedIds.some((id) => !player.hand.includes(id))) {
    return fail(state, "只能调度当前手牌中的卡牌");
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[playerId];
  nextPlayer.hand = nextPlayer.hand.filter((id) => !uniqueIds.has(id));
  const replacements = nextPlayer.drawPile.splice(0, selectedIds.length);
  nextPlayer.hand.push(...replacements);
  const reshuffled = shuffle(
    [...nextPlayer.drawPile, ...selectedIds],
    next.rngState,
  );
  nextPlayer.drawPile = reshuffled.items;
  next.rngState = reshuffled.state;
  nextPlayer.mulliganCompleted = true;

  const events: GameEvent[] = [
    {
      kind: "mulligan_completed",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}完成调度（${selectedIds.length}张）。`,
    },
  ];

  const nextMulliganPlayer: PlayerId = "player2";
  if (!next.players.player2.mulliganCompleted && playerId !== nextMulliganPlayer) {
    next.status = "handoff";
    next.handoff = { nextPlayer: nextMulliganPlayer, resume: "mulligan" };
  } else {
    next.status = "handoff";
    next.handoff = { nextPlayer: next.firstPlayer, resume: "start_turn" };
  }

  return success(next, events);
}

function startTurn(state: GameState, playerId: PlayerId) {
  expireOngoingEffects(state, { kind: "ready_start", playerId });
  state.status = "playing";
  state.phase = "ready";
  state.activePlayer = playerId;
  state.currentViewer = playerId;
  state.turnNumber += 1;
  state.turnFacts = {
    turnNumber: state.turnNumber,
    player1: { retreatedOperatorIds: [], defeatedOperatorIds: [] },
    player2: { retreatedOperatorIds: [], defeatedOperatorIds: [] },
  };
  state.effectUsages = state.effectUsages.filter(
    (usage) => usage.turnNumber === state.turnNumber,
  );
  state.players[playerId].turnsStarted += 1;
  state.handoff = null;
}

function confirmHandoff(state: GameState, playerId: PlayerId): CommandResult {
  if (state.status !== "handoff" || !state.handoff) {
    return fail(state, "当前没有等待确认的交接");
  }
  if (state.handoff.nextPlayer !== playerId) {
    return fail(state, "只有下一位玩家可以确认交接");
  }

  const next = structuredClone(state);
  const resume = next.handoff?.resume;
  next.currentViewer = playerId;
  next.handoff = null;
  const events: GameEvent[] = [];

  if (resume === "mulligan") {
    next.status = "mulligan";
  } else if (resume === "start_turn") {
    startTurn(next, playerId);
    events.push({
      kind: "turn_started",
      playerId,
      message: `第${next.turnNumber}回合开始，由${playerId === "player1" ? "玩家1" : "玩家2"}行动。`,
    });
  } else if (resume === "defend_attack") {
    next.status = "defending";
  } else {
    next.status = "playing";
    next.currentViewer = next.activePlayer;
  }

  return success(next, events);
}

function executeReadyPhase(state: GameState, playerId: PlayerId): GameEvent[] {
  const player = state.players[playerId];
  player.commanderIsUpright = true;
  for (const deployed of player.deploymentSlots) {
    if (deployed) {
      deployed.isUpright = true;
    }
  }

  const returnedToHand: string[] = [];
  player.redeployZone = player.redeployZone.flatMap((entry) => {
    const remainingCd = entry.remainingCd - 1;
    if (remainingCd === 0) {
      returnedToHand.push(entry.instanceId);
      return [];
    }
    return [{ ...entry, remainingCd }];
  });
  player.hand.push(...returnedToHand);

  if (player.turnsStarted === 1) {
    player.maxDp = playerId === state.firstPlayer ? 2 : 3;
  } else {
    player.maxDp = Math.min(10, player.maxDp + 2);
  }
  player.availableDp = player.maxDp;
  state.phase = "draw";
  const events: GameEvent[] = [];
  if (returnedToHand.length > 0) {
    events.push({
      kind: "redeploy_ready",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}有${returnedToHand.length}名干员完成再部署倒计时并返回手牌。`,
    });
  }
  events.push(
    {
      kind: "ready_completed",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}的DP恢复至${player.availableDp}/${player.maxDp}。`,
    },
  );
  return events;
}

function canTakeMainAction(state: GameState, playerId: PlayerId) {
  return (
    state.triggerQueue.length === 0 &&
    state.pendingTacticalSupport === null &&
    state.status === "playing" &&
    state.phase === "main" &&
    state.activePlayer === playerId &&
    state.currentViewer === playerId
  );
}

const tacticalSupportEffects: Record<string, string> = {
  "RI-S001": "RI-E013",
  "RI-S002": "RI-E014",
  "RI-S003": "RI-E015",
  "RI-S004": "RI-E016",
  "RI-S005": "RI-E017",
  "RM-S001": "RM-E012",
  "RM-S002": "RM-E013",
  "RM-S003": "RM-E014",
  "RM-S004": "RM-E015",
  "RM-S005": "RM-E016",
};

export type TacticalSupportPlayOptions =
  | { kind: "immediate" }
  | { kind: "operator"; slotIndexes: number[] }
  | { kind: "redeploy"; instanceIds: string[] }
  | { kind: "sacrifice"; slotIndexes: number[] }
  | { kind: "discard_support"; instanceIds: string[] }
  | { kind: "unavailable"; reason: string };

export type FieldPlayOptions =
  | { kind: "immediate" }
  | { kind: "unavailable"; reason: string };

export function getFieldPlayOptions(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  cardInstanceId: string,
): FieldPlayOptions {
  if (!canTakeMainAction(state, playerId)) {
    return { kind: "unavailable", reason: "只能在自己的主要阶段使用" };
  }
  const player = state.players[playerId];
  const instance = state.cardInstances[cardInstanceId];
  const card = content.cards.find(
    (candidate) => candidate.id === instance?.definitionId,
  );
  if (!player.hand.includes(cardInstanceId)) {
    return { kind: "unavailable", reason: "卡牌不在手牌中" };
  }
  if (!instance || instance.owner !== playerId || card?.type !== "field") {
    return { kind: "unavailable", reason: "不是可使用的场地卡" };
  }
  if (player.availableDp < card.cost) {
    return { kind: "unavailable", reason: "DP不足" };
  }
  return { kind: "immediate" };
}

function playField(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: string,
): CommandResult {
  const options = getFieldPlayOptions(
    state,
    content,
    playerId,
    cardInstanceId,
  );
  if (options.kind === "unavailable") return fail(state, options.reason);
  const instance = state.cardInstances[cardInstanceId];
  const card = content.cards.find(
    (candidate) => candidate.id === instance?.definitionId,
  );
  if (!instance || card?.type !== "field") {
    return fail(state, "场地卡数据无效");
  }

  const next = structuredClone(state);
  const player = next.players[playerId];
  const events: GameEvent[] = [];
  player.availableDp -= card.cost;
  player.hand = player.hand.filter((id) => id !== cardInstanceId);

  if (next.sharedField) {
    const previousInstance = next.cardInstances[next.sharedField.instanceId];
    const previousCard = content.cards.find(
      (candidate) => candidate.id === previousInstance?.definitionId,
    );
    if (!previousInstance || previousCard?.type !== "field") {
      return fail(state, "当前共享场地数据无效");
    }
    next.players[previousInstance.owner].discardPile.push(
      next.sharedField.instanceId,
    );
    events.push({
      kind: "field_replaced",
      playerId,
      message: `「${previousCard.name}」被替换并进入其拥有者的废弃区。`,
    });
  }

  next.sharedField = { instanceId: cardInstanceId, controllerId: playerId };
  events.push({
    kind: "field_played",
    playerId,
    message: `${playerId === "player1" ? "玩家1" : "玩家2"}支付${card.cost} DP，将「${card.name}」置入共享场地区。`,
  });
  return success(next, events);
}

function tacticalSupportContext(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  cardInstanceId: string,
) {
  const player = state.players[playerId];
  const instance = state.cardInstances[cardInstanceId];
  const card = content.cards.find(
    (candidate) => candidate.id === instance?.definitionId,
  );
  return { player, instance, card };
}

export function getTacticalSupportPlayOptions(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  cardInstanceId: string,
): TacticalSupportPlayOptions {
  if (!canTakeMainAction(state, playerId)) {
    return { kind: "unavailable", reason: "只能在自己的主要阶段使用" };
  }
  const { player, instance, card } = tacticalSupportContext(
    state,
    content,
    playerId,
    cardInstanceId,
  );
  if (!player.hand.includes(cardInstanceId)) {
    return { kind: "unavailable", reason: "卡牌不在手牌中" };
  }
  if (!instance || instance.owner !== playerId || card?.type !== "tactical_support") {
    return { kind: "unavailable", reason: "不是可使用的战术支援卡" };
  }
  const effectId = tacticalSupportEffects[card.id];
  if (!effectId) return { kind: "unavailable", reason: "效果尚未接入" };
  if (player.availableDp < card.cost) {
    return { kind: "unavailable", reason: "DP不足" };
  }

  if (card.id === "RI-S003") {
    const retreatedRhodesOperator = state.turnFacts[playerId].retreatedOperatorIds.some(
      (instanceId) => {
        const definitionId = state.cardInstances[instanceId]?.definitionId;
        return content.cards.find((candidate) => candidate.id === definitionId)
          ?.faction === "rhodes_island";
      },
    );
    if (!retreatedRhodesOperator) {
      return { kind: "unavailable", reason: "本回合尚未主动撤退罗德岛干员" };
    }
    if (!canUseEffect(state, playerId, effectId, 1)) {
      return { kind: "unavailable", reason: "本回合已经使用过同名卡" };
    }
    return { kind: "immediate" };
  }
  if (card.id === "RM-S005") {
    const defeatedReunionOperator = state.turnFacts[playerId].defeatedOperatorIds.some(
      (instanceId) => {
        const definitionId = state.cardInstances[instanceId]?.definitionId;
        return content.cards.find((candidate) => candidate.id === definitionId)
          ?.faction === "reunion";
      },
    );
    if (!defeatedReunionOperator) {
      return { kind: "unavailable", reason: "本回合尚无整合运动干员被击溃" };
    }
    const instanceIds = player.discardPile.filter((candidateId) => {
      const candidate = state.cardInstances[candidateId];
      const definition = content.cards.find(
        (item) => item.id === candidate?.definitionId,
      );
      return Boolean(
        definition?.type === "tactical_support" &&
        definition.faction === "reunion" &&
        definition.name !== "回收补给",
      );
    });
    return instanceIds.length > 0
      ? { kind: "discard_support", instanceIds }
      : { kind: "unavailable", reason: "废弃区没有可回收的战术支援卡" };
  }
  if (card.id === "RI-S004" || card.id === "RM-S003") {
    const instanceIds = player.redeployZone.flatMap((entry) => {
      if (entry.remainingCd !== 1) return [];
      const definition = content.cards.find(
        (item) => item.id === state.cardInstances[entry.instanceId]?.definitionId,
      );
      if (
        definition?.type !== "operator" ||
        definition.faction !== card.faction ||
        (card.id === "RM-S003" && definition.cost > 3)
      ) {
        return [];
      }
      return [entry.instanceId];
    });
    return instanceIds.length > 0
      ? { kind: "redeploy", instanceIds }
      : { kind: "unavailable", reason: "候场区没有符合条件且CD为1的干员" };
  }
  if (card.id === "RM-S002") {
    const slotIndexes = player.deploymentSlots.flatMap((deployed, slotIndex) => {
      if (!deployed?.isUpright) return [];
      const definition = getOperatorDefinition(content, state, deployed.instanceId);
      return definition?.faction === "reunion" ? [slotIndex] : [];
    });
    return slotIndexes.length > 0
      ? { kind: "sacrifice", slotIndexes }
      : { kind: "unavailable", reason: "没有可作为附加费用击溃的竖置干员" };
  }
  if (card.id === "RI-S005" || card.id === "RM-S004") {
    const slotIndexes = player.deploymentSlots.flatMap((deployed, slotIndex) =>
      deployed ? [slotIndex] : [],
    );
    return slotIndexes.length > 0
      ? { kind: "operator", slotIndexes }
      : { kind: "unavailable", reason: "没有可选择的己方干员" };
  }
  return { kind: "immediate" };
}

export function getLegalTacticalSupportTargets(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  cardInstanceId: string,
): number[] {
  const options = getTacticalSupportPlayOptions(
    state,
    content,
    playerId,
    cardInstanceId,
  );
  return options.kind === "operator" ? options.slotIndexes : [];
}

function drawCardsForSupport(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  events: GameEvent[],
) {
  const player = state.players[playerId];
  let drawn = 0;
  while (drawn < amount) {
    const instanceId = player.drawPile.shift();
    if (!instanceId) {
      if (drawn > 0) {
        events.push({
          kind: "effect_cards_drawn",
          playerId,
          message: `${playerId === "player1" ? "玩家1" : "玩家2"}因战术支援抽取${drawn}张牌。`,
        });
      }
      state.status = "finished";
      state.phase = "finished";
      state.winner = otherPlayer(playerId);
      state.finishReason = "deck_out";
      state.handoff = null;
      state.pendingAttack = null;
      state.pendingTacticalSupport = null;
      events.push({
        kind: "game_finished",
        playerId,
        message: `${playerId === "player1" ? "玩家1" : "玩家2"}因战术支援效果必须抽牌但牌库为空，对局结束。`,
      });
      return drawn;
    }
    player.hand.push(instanceId);
    drawn += 1;
  }
  events.push({
    kind: "effect_cards_drawn",
    playerId,
    message: `${playerId === "player1" ? "玩家1" : "玩家2"}因战术支援抽取${drawn}张牌。`,
  });
  return drawn;
}

function playTacticalSupport(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: string,
  target?: TacticalSupportTarget,
): CommandResult {
  if (!canTakeMainAction(state, playerId)) {
    return fail(state, "只能在自己的主要阶段使用战术支援卡");
  }
  const options = getTacticalSupportPlayOptions(
    state,
    content,
    playerId,
    cardInstanceId,
  );
  if (options.kind === "unavailable") return fail(state, options.reason);
  const { card } = tacticalSupportContext(state, content, playerId, cardInstanceId);
  if (card?.type !== "tactical_support") return fail(state, "战术支援卡数据无效");
  const effectId = tacticalSupportEffects[card.id];
  if (!effectId) return fail(state, "战术支援效果不存在");

  if (
    options.kind === "operator" &&
    (target?.kind !== "operator" || !options.slotIndexes.includes(target.slotIndex))
  ) return fail(state, "必须选择一名合法的己方干员");
  if (
    options.kind === "redeploy" &&
    (target?.kind !== "redeploy" || !options.instanceIds.includes(target.instanceId))
  ) return fail(state, "必须选择一张符合条件的候场干员卡");
  if (
    options.kind === "sacrifice" &&
    (target?.kind !== "sacrifice" || !options.slotIndexes.includes(target.slotIndex))
  ) return fail(state, "必须选择一名合法的竖置干员作为附加费用");
  if (
    options.kind === "discard_support" &&
    (target?.kind !== "discard_support" || !options.instanceIds.includes(target.instanceId))
  ) return fail(state, "必须选择一张可回收的战术支援卡");

  const next = structuredClone(state);
  const nextPlayer = next.players[playerId];
  nextPlayer.availableDp -= card.cost;
  nextPlayer.hand = nextPlayer.hand.filter((id) => id !== cardInstanceId);
  nextPlayer.discardPile.push(cardInstanceId);
  const events: GameEvent[] = [{
    kind: "tactical_support_played",
    playerId,
    message: `${playerId === "player1" ? "玩家1" : "玩家2"}使用「${card.name}」，支付${card.cost} DP。`,
  }];
  const triggerEvents: TriggerEventSnapshot[] = [];

  if (options.kind === "operator" && target?.kind === "operator") {
    const deployed = nextPlayer.deploymentSlots[target.slotIndex];
    const targetCard = deployed
      ? getOperatorDefinition(content, next, deployed.instanceId)
      : undefined;
    if (!deployed || !targetCard) return fail(state, "目标干员数据无效");
    addOngoingEffect(next, {
      kind: "stat_modifier",
      effectId,
      controllerId: playerId,
      sourceInstanceId: cardInstanceId,
      targetInstanceId: deployed.instanceId,
      atkDelta: 2,
      defDelta: 0,
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    events.push({
      kind: "tactical_support_applied",
      playerId,
      message: `「${targetCard.name}」的ATK本回合提高2。`,
    });
  } else if (options.kind === "redeploy" && target?.kind === "redeploy") {
    const definition = getOperatorDefinition(content, next, target.instanceId);
    nextPlayer.redeployZone = nextPlayer.redeployZone.filter(
      (entry) => entry.instanceId !== target.instanceId,
    );
    nextPlayer.hand.push(target.instanceId);
    addOngoingEffect(next, {
      kind: "deployment_cost_modifier",
      effectId,
      controllerId: playerId,
      sourceInstanceId: cardInstanceId,
      targetInstanceId: target.instanceId,
      amount: -1,
      expires: { kind: "turn_end", turnNumber: next.turnNumber },
    });
    events.push({
      kind: "redeploy_card_returned",
      playerId,
      message: `「${definition?.name ?? "候场干员"}」返回手牌，本回合下一次部署费用减少1。`,
    });
  } else if (options.kind === "sacrifice" && target?.kind === "sacrifice") {
    const deployed = nextPlayer.deploymentSlots[target.slotIndex];
    const sacrificed = deployed
      ? getOperatorDefinition(content, next, deployed.instanceId)
      : undefined;
    if (!deployed || !sacrificed) return fail(state, "附加费用目标数据无效");
    moveDefeatedOperator(content, next, playerId, target.slotIndex);
    events.push({
      kind: "operator_defeated",
      playerId,
      message: `「${sacrificed.name}」作为「${card.name}」的附加费用被击溃。`,
    });
    triggerEvents.push({
      kind: "operator_defeated",
      subjectPlayerId: playerId,
      subjectInstanceId: deployed.instanceId,
      subjectDefinitionId: sacrificed.id,
      subjectSlotIndex: target.slotIndex,
      causePlayerId: playerId,
      causeInstanceId: cardInstanceId,
    });
    drawCardsForSupport(next, playerId, 2, events);
  } else if (options.kind === "discard_support" && target?.kind === "discard_support") {
    const recovered = content.cards.find(
      (candidate) =>
        candidate.id === next.cardInstances[target.instanceId]?.definitionId,
    );
    nextPlayer.discardPile = nextPlayer.discardPile.filter(
      (instanceId) => instanceId !== target.instanceId,
    );
    nextPlayer.hand.push(target.instanceId);
    events.push({
      kind: "support_card_recovered",
      playerId,
      message: `从废弃区将「${recovered?.name ?? "战术支援"}」返回手牌。`,
    });
  } else if (card.id === "RI-S001" || card.id === "RM-S001") {
    const maximumOperatorCost = card.id === "RI-S001" ? 4 : 3;
    const revealedInstanceIds = nextPlayer.drawPile.splice(0, 4);
    if (revealedInstanceIds.length > 0) {
      next.pendingTacticalSupport = {
        kind: "deck_search_choice",
        controllerId: playerId,
        sourceInstanceId: cardInstanceId,
        effectId,
        revealedInstanceIds,
        maximumOperatorCost,
      };
    }
    events.push({
      kind: "deck_cards_revealed",
      playerId,
      message: `查看牌库顶${revealedInstanceIds.length}张牌。`,
    });
  } else if (card.id === "RI-S002") {
    drawCardsForSupport(next, playerId, 2, events);
    if (next.status !== "finished") {
      next.pendingTacticalSupport = {
        kind: "discard_after_draw",
        controllerId: playerId,
        sourceInstanceId: cardInstanceId,
        effectId,
      };
    }
  } else if (card.id === "RI-S003") {
    recordEffectUsage(next, playerId, effectId);
    drawCardsForSupport(next, playerId, 2, events);
  }

  return success(
    next,
    events,
    content,
    next.status === "finished" ? [] : triggerEvents,
  );
}

function resolveTacticalSupport(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  action: Extract<GameCommand, { type: "RESOLVE_TACTICAL_SUPPORT" }>["action"],
): CommandResult {
  const pending = state.pendingTacticalSupport;
  if (!pending) return fail(state, "当前没有待处理的战术支援效果");
  if (pending.controllerId !== playerId || state.currentViewer !== playerId) {
    return fail(state, "只有战术支援的控制者可以继续结算");
  }
  const next = structuredClone(state);
  const nextPending = next.pendingTacticalSupport;
  if (!nextPending) return fail(state, "待处理效果已经不存在");
  const player = next.players[playerId];
  const events: GameEvent[] = [];

  if (nextPending.kind === "deck_search_choice") {
    if (action.type !== "CHOOSE_SEARCH_RESULT") {
      return fail(state, "当前需要选择要加入手牌的干员卡");
    }
    if (action.instanceId !== null) {
      if (!nextPending.revealedInstanceIds.includes(action.instanceId)) {
        return fail(state, "只能选择本次查看到的卡牌");
      }
      const definition = content.cards.find(
        (card) => card.id === next.cardInstances[action.instanceId!]?.definitionId,
      );
      if (
        definition?.type !== "operator" ||
        definition.faction !== content.cards.find(
          (card) => card.id === next.cardInstances[nextPending.sourceInstanceId]?.definitionId,
        )?.faction ||
        definition.cost > nextPending.maximumOperatorCost
      ) {
        return fail(state, "选择的卡牌不符合检索条件");
      }
      player.hand.push(action.instanceId);
      events.push({
        kind: "deck_search_card_added",
        playerId,
        message: `展示「${definition.name}」并加入手牌。`,
      });
    }
    const remaining = nextPending.revealedInstanceIds.filter(
      (instanceId) => instanceId !== action.instanceId,
    );
    if (remaining.length <= 1) {
      player.drawPile.push(...remaining);
      next.pendingTacticalSupport = null;
      events.push({
        kind: "deck_search_completed",
        playerId,
        message: `将其余${remaining.length}张牌置于牌库底。`,
      });
    } else {
      next.pendingTacticalSupport = {
        kind: "deck_search_order",
        controllerId: playerId,
        sourceInstanceId: nextPending.sourceInstanceId,
        effectId: nextPending.effectId,
        remainingInstanceIds: remaining,
      };
    }
  } else if (nextPending.kind === "deck_search_order") {
    if (action.type !== "ORDER_SEARCH_REMAINDER") {
      return fail(state, "当前需要排列其余卡牌的牌库底顺序");
    }
    const expected = [...nextPending.remainingInstanceIds].sort();
    const actual = [...action.instanceIds].sort();
    if (
      expected.length !== actual.length ||
      new Set(action.instanceIds).size !== action.instanceIds.length ||
      expected.some((instanceId, index) => instanceId !== actual[index])
    ) {
      return fail(state, "必须且只能排列本次查看剩余的全部卡牌");
    }
    player.drawPile.push(...action.instanceIds);
    next.pendingTacticalSupport = null;
    events.push({
      kind: "deck_search_completed",
      playerId,
      message: `按选择顺序将${action.instanceIds.length}张牌置于牌库底。`,
    });
  } else {
    if (action.type !== "DISCARD_HAND_CARD") {
      return fail(state, "当前需要弃置一张手牌");
    }
    if (!player.hand.includes(action.instanceId)) {
      return fail(state, "只能弃置当前手牌中的卡牌");
    }
    const definition = content.cards.find(
      (card) => card.id === next.cardInstances[action.instanceId]?.definitionId,
    );
    player.hand = player.hand.filter((instanceId) => instanceId !== action.instanceId);
    player.discardPile.push(action.instanceId);
    next.pendingTacticalSupport = null;
    events.push({
      kind: "effect_card_discarded",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}弃置「${definition?.name ?? "一张手牌"}」。`,
    });
  }
  return success(next, events);
}

function hasInterceptKeyword(
  content: GameContent,
  definitionId: string,
): boolean {
  return content.effects.some(
    (effect) =>
      effect.cardId === definitionId &&
      effect.abilityName === "拦截" &&
      effect.text.trim() === "【拦截】",
  );
}

function isSlotIndex(slotIndex: number) {
  return Number.isInteger(slotIndex) && slotIndex >= 0 && slotIndex < 7;
}

export function getDeploymentCost(
  state: GameState,
  content: GameContent,
  cardInstanceId: string,
) {
  const definition = content.cards.find(
    (card) => card.id === state.cardInstances[cardInstanceId]?.definitionId,
  );
  if (definition?.type !== "operator") return null;
  return Math.max(
    0,
    definition.cost + getDeploymentCostModifier(state, cardInstanceId),
  );
}

export function getLegalAttackTargets(
  state: GameState,
  content: GameContent,
  playerId: PlayerId,
  attackerSlotIndex: number,
): AttackTarget[] {
  if (!canTakeMainAction(state, playerId) || !isSlotIndex(attackerSlotIndex)) {
    return [];
  }
  const attacker = state.players[playerId].deploymentSlots[attackerSlotIndex];
  if (
    !attacker ||
    !attacker.isUpright ||
    (attacker.deployedTurn === state.turnNumber &&
      !hasAttackPermission(state, attacker.instanceId, "ignore_deployment_turn"))
  ) {
    return [];
  }
  const attackerCard = getOperatorDefinition(
    content,
    state,
    attacker.instanceId,
  );
  if (!attackerCard) return [];

  const defenderId = otherPlayer(playerId);
  const targets: AttackTarget[] = [];
  if (attackerCard.position === "ground") targets.push({ kind: "shield" });

  state.players[defenderId].deploymentSlots.forEach((target, slotIndex) => {
    if (!target) return;
    if (attackerCard.position === "high_ground" || !target.isUpright) {
      targets.push({ kind: "operator", slotIndex });
    }
  });
  return targets;
}

export function getLegalInterceptors(
  state: GameState,
  content: GameContent,
): number[] {
  const pending = state.pendingAttack;
  if (!pending || state.status !== "defending") return [];
  const defender = state.players[pending.defenderPlayerId];
  return defender.deploymentSlots.flatMap((deployed, slotIndex) => {
    if (!deployed || !deployed.isUpright) return [];
    if (pending.target.kind === "operator" && pending.target.slotIndex === slotIndex) {
      return [];
    }
    const definitionId = state.cardInstances[deployed.instanceId]?.definitionId;
    const card = getOperatorDefinition(content, state, deployed.instanceId);
    if (!definitionId || !card) return [];
    const canIntercept =
      hasGrantedKeyword(state, deployed.instanceId, "intercept") ||
      hasInterceptKeyword(content, definitionId);
    if (pending.target.kind === "shield") {
      return card.position === "ground" || canIntercept
        ? [slotIndex]
        : [];
    }
    return canIntercept ? [slotIndex] : [];
  });
}

function targetsMatch(left: AttackTarget, right: AttackTarget) {
  return (
    left.kind === right.kind &&
    (left.kind === "shield" ||
      (right.kind === "operator" && left.slotIndex === right.slotIndex))
  );
}

function declareAttack(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  attackerSlotIndex: number,
  target: AttackTarget,
): CommandResult {
  const legalTargets = getLegalAttackTargets(
    state,
    content,
    playerId,
    attackerSlotIndex,
  );
  if (!legalTargets.some((candidate) => targetsMatch(candidate, target))) {
    return fail(state, "攻击者或攻击目标不合法");
  }

  const attacker = state.players[playerId].deploymentSlots[attackerSlotIndex];
  if (!attacker) return fail(state, "攻击干员不存在");
  const attackerCard = getOperatorDefinition(content, state, attacker.instanceId);
  if (!attackerCard) return fail(state, "攻击干员数据无效");
  const defenderId = otherPlayer(playerId);
  const targetName =
    target.kind === "shield"
      ? `${defenderId === "player1" ? "玩家1" : "玩家2"}的理智盾`
      : `位置${target.slotIndex + 1}的干员`;

  const next = structuredClone(state);
  const nextAttacker = next.players[playerId].deploymentSlots[attackerSlotIndex];
  if (!nextAttacker) return fail(state, "攻击干员不存在");
  nextAttacker.isUpright = false;
  next.pendingAttack = {
    attackerPlayerId: playerId,
    attackerSlotIndex,
    defenderPlayerId: defenderId,
    target,
  };
  next.status = "handoff";
  next.handoff = { nextPlayer: defenderId, resume: "defend_attack" };

  return success(next, [
    {
      kind: "attack_declared",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}横置「${attackerCard.name}」，向${targetName}发起攻击。`,
    },
  ]);
}

function resolveAttack(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  interceptSlotIndex: number | null,
): CommandResult {
  const pending = state.pendingAttack;
  if (
    state.status !== "defending" ||
    !pending ||
    pending.defenderPlayerId !== playerId ||
    state.currentViewer !== playerId
  ) {
    return fail(state, "当前不能由该玩家处理拦截");
  }
  if (
    interceptSlotIndex !== null &&
    !getLegalInterceptors(state, content).includes(interceptSlotIndex)
  ) {
    return fail(state, "选择的干员不能拦截此次攻击");
  }

  const next = structuredClone(state);
  const nextPending = next.pendingAttack;
  if (!nextPending) return fail(state, "没有待结算的攻击");
  const attacker = next.players[nextPending.attackerPlayerId]
    .deploymentSlots[nextPending.attackerSlotIndex];
  if (!attacker) return fail(state, "攻击干员已经离开部署区");
  const attackerCard = getOperatorDefinition(content, next, attacker.instanceId);
  if (!attackerCard) return fail(state, "攻击干员数据无效");
  const attackerStats = getCurrentOperatorStats(
    content,
    next,
    nextPending.attackerPlayerId,
    nextPending.attackerSlotIndex,
  );
  if (!attackerStats) return fail(state, "攻击干员数值无效");

  const events: GameEvent[] = [];
  const triggerEvents: TriggerEventSnapshot[] = [];
  let finalTarget: AttackTarget = nextPending.target;
  if (interceptSlotIndex !== null) {
    const interceptor = next.players[playerId].deploymentSlots[interceptSlotIndex];
    if (!interceptor) return fail(state, "拦截干员已经离开部署区");
    const interceptorCard = getOperatorDefinition(
      content,
      next,
      interceptor.instanceId,
    );
    if (!interceptorCard) return fail(state, "拦截干员数据无效");
    interceptor.isUpright = false;
    finalTarget = { kind: "operator", slotIndex: interceptSlotIndex };
    events.push({
      kind: "attack_intercepted",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}横置「${interceptorCard.name}」进行拦截。`,
    });
  }

  const defender = next.players[playerId];
  if (finalTarget.kind === "shield") {
    defender.shields -= 1;
    events.push({
      kind: "shield_damaged",
      playerId,
      message: `攻击未被拦截，${playerId === "player1" ? "玩家1" : "玩家2"}失去1个理智盾，剩余${defender.shields}个。`,
    });
    if (defender.shields === 0) {
      next.status = "finished";
      next.phase = "finished";
      next.winner = nextPending.attackerPlayerId;
      next.finishReason = "shields_depleted";
      events.push({
        kind: "game_finished",
        message: `${nextPending.attackerPlayerId === "player1" ? "玩家1" : "玩家2"}击破对手最后一个理智盾，获得胜利。`,
      });
    }
  } else {
    const target = defender.deploymentSlots[finalTarget.slotIndex];
    if (!target) return fail(state, "攻击目标已经离开部署区");
    const targetCard = getOperatorDefinition(content, next, target.instanceId);
    if (!targetCard) return fail(state, "攻击目标数据无效");
    const targetStats = getCurrentOperatorStats(
      content,
      next,
      playerId,
      finalTarget.slotIndex,
    );
    if (!targetStats) return fail(state, "攻击目标数值无效");
    const faustAttackBonus =
      attackerCard.id === "RM-O010" && !target.isUpright ? 2 : 0;
    const effectiveAttack = attackerStats.atk + faustAttackBonus;
    if (faustAttackBonus > 0) {
      events.push({
        kind: "attack_stat_bonus",
        playerId: nextPending.attackerPlayerId,
        message: `浮士德攻击横置干员，本次攻击ATK提高2。`,
      });
    }
    if (effectiveAttack > targetStats.def) {
      const extraDamage = next.ongoingEffects.some(
        (effect) =>
          effect.kind === "stat_modifier" &&
          effect.effectId === "RM-E001" &&
          effect.targetInstanceId === attacker.instanceId,
      ) ? 1 : 0;
      const damage = Math.min(1 + extraDamage, target.currentLife);
      target.currentLife -= damage;
      if (target.currentLife === 0) {
        const defeatedInstanceId = target.instanceId;
        moveDefeatedOperator(content, next, playerId, finalTarget.slotIndex);
        events.push({
          kind: "operator_defeated",
          playerId,
          message: `「${attackerCard.name}」击破并击溃「${targetCard.name}」；后者进入再部署候场区（CD ${targetCard.redeployCd}）。`,
        });
        triggerEvents.push({
          kind: "operator_defeated",
          subjectPlayerId: playerId,
          subjectInstanceId: defeatedInstanceId,
          subjectDefinitionId: targetCard.id,
          subjectSlotIndex: finalTarget.slotIndex,
          causePlayerId: nextPending.attackerPlayerId,
          causeInstanceId: attacker.instanceId,
          wasInterceptor: interceptSlotIndex !== null,
        });
      } else {
        events.push({
          kind: "operator_damaged",
          playerId,
          message: `「${attackerCard.name}」击破「${targetCard.name}」，使其失去${damage}格生命，剩余${target.currentLife}/${targetCard.life}。`,
        });
      }
    } else {
      events.push({
        kind: "attack_blocked",
        playerId,
        message: `「${attackerCard.name}」的ATK ${effectiveAttack}未高于「${targetCard.name}」的DEF ${targetStats.def}，未能击破。`,
      });
    }
  }

  next.pendingAttack = null;
  if (next.status !== "finished") {
    next.status = "handoff";
    next.handoff = {
      nextPlayer: nextPending.attackerPlayerId,
      resume: "resume_main",
    };
  } else {
    next.handoff = null;
  }
  return success(next, events, content, triggerEvents);
}

function deployOperator(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: string,
  slotIndex: number,
): CommandResult {
  if (!canTakeMainAction(state, playerId)) {
    return fail(state, "只能在自己的主要阶段部署干员");
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 7) {
    return fail(state, "部署位不存在");
  }

  const player = state.players[playerId];
  if (!player.hand.includes(cardInstanceId)) {
    return fail(state, "只能部署自己手牌中的干员");
  }
  const instance = state.cardInstances[cardInstanceId];
  const definition = content.cards.find(
    (card) => card.id === instance?.definitionId,
  );
  if (!instance || instance.owner !== playerId || definition?.type !== "operator") {
    return fail(state, "选择的卡牌不是可部署干员");
  }
  if (player.deploymentSlots[slotIndex]) {
    return fail(state, "该部署位已经被占用");
  }
  const deployedCount = player.deploymentSlots.filter(Boolean).length;
  if (deployedCount >= player.deploymentCapacity) {
    return fail(state, "已经达到当前部署容量");
  }
  const deploymentCost = getDeploymentCost(state, content, cardInstanceId);
  if (deploymentCost === null) return fail(state, "部署费用数据无效");
  if (player.availableDp < deploymentCost) {
    return fail(state, "可用DP不足");
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[playerId];
  nextPlayer.availableDp -= deploymentCost;
  nextPlayer.hand = nextPlayer.hand.filter((id) => id !== cardInstanceId);
  nextPlayer.deploymentSlots[slotIndex] = {
    instanceId: cardInstanceId,
    currentLife: definition.life,
    isUpright: true,
    deployedTurn: next.turnNumber,
    atkModifier: 0,
    defModifier: 0,
  };

  const deploymentEvents = consumeNextDeploymentEffects(
    next,
    playerId,
    definition,
    cardInstanceId,
  );
  const consumedCostModifiers = consumeDeploymentCostModifiers(
    next,
    cardInstanceId,
  );
  if (consumedCostModifiers > 0) {
    deploymentEvents.push({
      kind: "deployment_discount_consumed",
      playerId,
      message: `「${definition.name}」消耗部署费用减免。`,
    });
  }

  return success(next, [
    {
      kind: "operator_deployed",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}将「${definition.name}」部署至位置${slotIndex + 1}，支付${deploymentCost} DP。`,
    },
    ...deploymentEvents,
  ], content, [{
    kind: "operator_deployed",
    subjectPlayerId: playerId,
    subjectInstanceId: cardInstanceId,
    subjectDefinitionId: definition.id,
    subjectSlotIndex: slotIndex,
  }]);
}

function retreatOperator(
  content: GameContent,
  state: GameState,
  playerId: PlayerId,
  slotIndex: number,
): CommandResult {
  if (!canTakeMainAction(state, playerId)) {
    return fail(state, "只能在自己的主要阶段主动撤退干员");
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 7) {
    return fail(state, "部署位不存在");
  }

  const player = state.players[playerId];
  const deployed = player.deploymentSlots[slotIndex];
  if (!deployed) return fail(state, "该部署位没有干员");
  if (!deployed.isUpright) return fail(state, "横置干员不能主动撤退");
  if (deployed.deployedTurn === state.turnNumber) {
    return fail(state, "本回合部署的干员不能主动撤退");
  }

  const instance = state.cardInstances[deployed.instanceId];
  const definition = content.cards.find(
    (card) => card.id === instance?.definitionId,
  );
  if (!instance || instance.owner !== playerId || definition?.type !== "operator") {
    return fail(state, "部署位中的干员数据无效");
  }

  const next = structuredClone(state);
  const nextPlayer = next.players[playerId];
  nextPlayer.deploymentSlots[slotIndex] = null;
  removeAttachedEffects(next, deployed.instanceId);
  nextPlayer.redeployZone.push({
    instanceId: deployed.instanceId,
    remainingCd: 1,
    source: "retreat",
  });
  const recoveredDp = Math.min(
    definition.retreatRefund,
    nextPlayer.maxDp - nextPlayer.availableDp,
  );
  nextPlayer.availableDp += recoveredDp;

  return success(next, [
    {
      kind: "operator_retreated",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}主动撤退「${definition.name}」，返费${definition.retreatRefund} DP（实际恢复${recoveredDp} DP），并进入再部署候场区（CD 1）。`,
    },
  ], content, [{
    kind: "operator_retreated",
    subjectPlayerId: playerId,
    subjectInstanceId: deployed.instanceId,
    subjectDefinitionId: definition.id,
    subjectSlotIndex: slotIndex,
    subjectWasDamaged: deployed.currentLife < definition.life,
  }]);
}

function executeDrawPhase(state: GameState, playerId: PlayerId): GameEvent[] {
  const player = state.players[playerId];
  if (playerId === state.firstPlayer && player.turnsStarted === 1) {
    state.phase = "main";
    return [
      {
        kind: "draw_skipped",
        playerId,
        message: "先手玩家跳过第一个抽牌阶段。",
      },
    ];
  }

  const cardId = player.drawPile.shift();
  if (!cardId) {
    state.status = "finished";
    state.phase = "finished";
    state.winner = otherPlayer(playerId);
    state.finishReason = "deck_out";
    return [
      {
        kind: "game_finished",
        playerId,
        message: `${playerId === "player1" ? "玩家1" : "玩家2"}必须抽牌但牌库为空，对局结束。`,
      },
    ];
  }

  player.hand.push(cardId);
  state.phase = "main";
  return [
    {
      kind: "card_drawn",
      playerId,
      message: `${playerId === "player1" ? "玩家1" : "玩家2"}抽1张牌。`,
    },
  ];
}

function advancePhase(state: GameState, playerId: PlayerId): CommandResult {
  if (state.triggerQueue.length > 0) {
    return fail(state, "必须先结算待处理的触发能力");
  }
  if (
    state.status !== "playing" ||
    state.activePlayer !== playerId ||
    state.currentViewer !== playerId
  ) {
    return fail(state, "当前不能由该玩家推进阶段");
  }

  const next = structuredClone(state);
  let events: GameEvent[];

  if (next.phase === "ready") {
    events = executeReadyPhase(next, playerId);
  } else if (next.phase === "draw") {
    events = executeDrawPhase(next, playerId);
  } else if (next.phase === "main") {
    next.phase = "end";
    events = [
      { kind: "main_ended", playerId, message: "主要阶段结束。" },
    ];
  } else if (next.phase === "end") {
    const followingPlayer = otherPlayer(playerId);
    const expiredEffects = expireOngoingEffects(next, {
      kind: "turn_end",
      turnNumber: next.turnNumber,
    });
    next.phase = "setup";
    next.status = "handoff";
    next.handoff = { nextPlayer: followingPlayer, resume: "start_turn" };
    events = [
      {
        kind: "turn_ended",
        playerId,
        message: `第${next.turnNumber}回合结束。`,
      },
    ];
    if (expiredEffects.length > 0) {
      events.push({
        kind: "temporary_effects_expired",
        playerId,
        message: `本回合结束，移除${expiredEffects.length}项持续效果。`,
      });
    }
  } else {
    return fail(state, "当前阶段不能推进");
  }

  return success(next, events);
}

export function applyGameCommand(
  state: GameState,
  command: GameCommand,
  content: GameContent,
): CommandResult {
  if (command.type === "RESOLVE_TACTICAL_SUPPORT") {
    return resolveTacticalSupport(
      state,
      content,
      command.playerId,
      command.action,
    );
  }
  if (command.type === "CONFIRM_TRIGGER_HANDOFF") {
    return confirmTriggerHandoff(state, command.playerId);
  }
  if (command.type === "RESOLVE_TRIGGER") {
    return resolveTrigger(
      state,
      content,
      command.playerId,
      command.triggerId,
      command.action,
      command.target,
      command.discardInstanceId,
    );
  }
  if (state.triggerQueue.length > 0) {
    return fail(state, "必须先结算待处理的触发能力");
  }
  if (state.pendingTacticalSupport) {
    return fail(state, "必须先完成战术支援卡的结算");
  }
  if (command.type === "ACTIVATE_ABILITY") {
    return activateAbility(
      state,
      content,
      command.playerId,
      command.source,
      command.target,
    );
  }
  if (command.type === "PLAY_FIELD") {
    return playField(
      content,
      state,
      command.playerId,
      command.cardInstanceId,
    );
  }
  if (command.type === "SUBMIT_MULLIGAN") {
    return submitMulligan(state, command.playerId, command.cardInstanceIds);
  }
  if (command.type === "CONFIRM_HANDOFF") {
    return confirmHandoff(state, command.playerId);
  }
  if (command.type === "ADVANCE_PHASE") {
    return advancePhase(state, command.playerId);
  }
  if (command.type === "DEPLOY_OPERATOR") {
    return deployOperator(
      content,
      state,
      command.playerId,
      command.cardInstanceId,
      command.slotIndex,
    );
  }
  if (command.type === "RETREAT_OPERATOR") {
    return retreatOperator(content, state, command.playerId, command.slotIndex);
  }
  if (command.type === "PLAY_TACTICAL_SUPPORT") {
    return playTacticalSupport(
      content,
      state,
      command.playerId,
      command.cardInstanceId,
      command.target,
    );
  }
  if (command.type === "DECLARE_ATTACK") {
    return declareAttack(
      content,
      state,
      command.playerId,
      command.attackerSlotIndex,
      command.target,
    );
  }
  return resolveAttack(
    content,
    state,
    command.playerId,
    command.interceptSlotIndex,
  );
}

export function getCardDefinitionId(
  state: GameState,
  instanceId: string,
): string | undefined {
  return state.cardInstances[instanceId]?.definitionId;
}
