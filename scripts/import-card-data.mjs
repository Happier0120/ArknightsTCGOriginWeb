import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";
import readXlsxFile from "read-excel-file/node";

const typeMap = new Map([
  ["指挥官", "commander"],
  ["干员", "operator"],
  ["战术支援", "tactical_support"],
  ["场地", "field"],
]);

const factionMap = new Map([
  ["罗德岛", "rhodes_island"],
  ["整合运动", "reunion"],
]);

const positionMap = new Map([
  ["地面", "ground"],
  ["高台", "high_ground"],
]);

const tapMap = new Map([
  ["是", "yes"],
  ["否", "no"],
  ["可选", "optional"],
]);

const supportKindMap = new Map([
  ["即时型", "instant"],
  ["持续型", "persistent"],
]);

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`无法识别的参数：${key ?? "<空>"}`);
    }
    result[key.slice(2)] = value;
  }
  return result;
}

function text(value) {
  return value === null || value === undefined || value === ""
    ? undefined
    : String(value).trim();
}

function number(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`期待数字，实际为：${value}`);
  }
  return parsed;
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function table(rows, sheetName) {
  const headers = new Map(rows[0].map((value, index) => [text(value), index]));
  return {
    rows: rows.slice(1),
    value(row, header) {
      const column = headers.get(header);
      if (column === undefined) throw new Error(`${sheetName}缺少列：${header}`);
      return row[column];
    },
  };
}

function mapCards(rows) {
  const source = table(rows, "卡牌");
  const cards = [];

  for (const row of source.rows) {
    const id = text(source.value(row, "卡牌ID"));
    if (!id) continue;

    const rawType = text(source.value(row, "类型"));
    const rawFaction = text(source.value(row, "阵营"));
    const type = typeMap.get(rawType);
    const faction = factionMap.get(rawFaction);
    if (!type || !faction) {
      throw new Error(`卡牌${id}具有未知类型或阵营`);
    }

    const base = {
      id,
      type,
      name: text(source.value(row, "名称")),
      faction,
      designStatus: text(source.value(row, "设计状态")),
      notes: text(source.value(row, "备注")),
    };

    if (type === "commander") {
      cards.push(
        compact({
          ...base,
          initialShields: number(source.value(row, "初始理智盾")),
        }),
      );
    } else if (type === "operator") {
      cards.push(
        compact({
          ...base,
          profession: text(source.value(row, "职业")),
          position: positionMap.get(text(source.value(row, "站位"))),
          cost: number(source.value(row, "费用DP")),
          atk: number(source.value(row, "ATK")),
          def: number(source.value(row, "DEF")),
          life: number(source.value(row, "生命格")),
          redeployCd: number(source.value(row, "再部署CD")),
          retreatRefund: number(source.value(row, "撤退返费")),
        }),
      );
    } else if (type === "tactical_support") {
      const rawSupportKind = text(source.value(row, "支援类别"));
      const supportKind = supportKindMap.get(rawSupportKind);
      if (!supportKind) {
        throw new Error(`卡牌${id}具有未知支援类别：${rawSupportKind}`);
      }
      cards.push(
        compact({
          ...base,
          supportKind,
          cost: number(source.value(row, "费用DP")),
        }),
      );
    } else {
      cards.push(
        compact({
          ...base,
          cost: number(source.value(row, "费用DP")),
        }),
      );
    }
  }

  return cards;
}

function mapEffects(rows) {
  const source = table(rows, "效果");
  const effects = [];

  for (const row of source.rows) {
    const id = text(source.value(row, "效果ID"));
    if (!id) continue;

    effects.push(
      compact({
        id,
        cardId: text(source.value(row, "所属卡牌ID")),
        abilityName: text(source.value(row, "能力名称")),
        category: text(source.value(row, "能力类别")),
        timing: text(source.value(row, "发动／触发时机")),
        cost: number(source.value(row, "费用DP")),
        tap: tapMap.get(text(source.value(row, "需横置"))),
        otherCost: text(source.value(row, "其他费用")),
        target: text(source.value(row, "目标")),
        text: text(source.value(row, "卡面文本")),
        notes: text(source.value(row, "备注")),
        resolution: text(source.value(row, "生效方式")),
        usageLimit: text(source.value(row, "次数限制")),
        duration: text(source.value(row, "持续时间")),
      }),
    );
  }

  return effects;
}

function mapDeck(rows, cards, deckName) {
  const source = table(rows, "预组");
  const entries = [];
  let id;

  for (const row of source.rows) {
    const rowDeckId = text(source.value(row, "预组ID"));
    if (!rowDeckId) break;
    id ??= rowDeckId;
    entries.push({
      cardId: text(source.value(row, "卡牌ID")),
      quantity: number(source.value(row, "数量")),
    });
  }

  const commander = cards.find((card) => card.type === "commander");
  if (!id || !commander) throw new Error(`${deckName}缺少预组或指挥官数据`);

  return {
    id,
    name: deckName,
    faction: commander.faction,
    commanderId: commander.id,
    entries,
  };
}

async function readSource(file, deckName) {
  const sheets = await readXlsxFile(file);
  const getSheet = (name) => {
    const sheet = sheets.find((candidate) => candidate.sheet === name);
    if (!sheet) throw new Error(`缺少工作表：${name}`);
    return sheet.data;
  };
  const cardRows = getSheet("卡牌");
  const effectRows = getSheet("效果");
  const deckRows = getSheet("预组");
  const cards = mapCards(cardRows);
  return {
    cards,
    effects: mapEffects(effectRows),
    deck: mapDeck(deckRows, cards, deckName),
  };
}

const args = parseArguments(process.argv.slice(2));
if (!args.rhodes || !args.reunion) {
  throw new Error(
    "用法：npm run import:cards -- --rhodes <罗德岛xlsx> --reunion <整合运动xlsx>",
  );
}

const [rhodes, reunion] = await Promise.all([
  readSource(args.rhodes, "罗德岛·并肩而行"),
  readSource(args.reunion, "整合运动"),
]);

const content = {
  schemaVersion: 1,
  cards: [...rhodes.cards, ...reunion.cards],
  effects: [...rhodes.effects, ...reunion.effects],
  decks: [rhodes.deck, reunion.deck],
};

const outputDirectory = path.resolve("src/content/generated");
const outputFile = path.join(outputDirectory, "content.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(content, null, 2)}\n`, "utf8");
console.log(
  `已生成 ${outputFile}：${content.cards.length}张卡牌定义、${content.effects.length}条效果、${content.decks.length}套预组。`,
);
