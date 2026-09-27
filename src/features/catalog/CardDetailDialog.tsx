import { useEffect, type CSSProperties } from "react";
import type { CardDefinition } from "../../content";
import { effectTypeLabel } from "../cardPresentation";
import type { DeckCatalogItem } from "./selectors";

const typeLabels = {
  commander: "指挥官",
  operator: "干员",
  tactical_support: "战术支援",
  field: "场地",
} as const;

interface CardDetailDialogProps {
  item: DeckCatalogItem;
  onClose: () => void;
}

function statRows(card: CardDefinition) {
  if (card.type === "commander") {
    return [{ label: "初始理智盾", value: card.initialShields }];
  }
  if (card.type === "operator") {
    return [
      { label: "部署费用", value: `${card.cost} DP` },
      { label: "职业", value: card.profession },
      { label: "站位", value: card.position === "ground" ? "地面" : "高台" },
      { label: "ATK", value: card.atk },
      { label: "DEF", value: card.def },
      { label: "生命格", value: card.life },
      { label: "再部署 CD", value: card.redeployCd },
      { label: "撤退返费", value: `${card.retreatRefund} DP` },
    ];
  }
  if (card.type === "tactical_support") {
    return [
      { label: "使用费用", value: `${card.cost} DP` },
      {
        label: "支援类别",
        value: card.supportKind === "instant" ? "即时型" : "持续型",
      },
    ];
  }
  return [{ label: "使用费用", value: `${card.cost} DP` }];
}

export function CardDetailDialog({ item, onClose }: CardDetailDialogProps) {
  const { card, effects } = item;
  const stats = statRows(card);
  const statGridStyle = {
    "--stat-columns": Math.min(4, stats.length),
    "--mobile-stat-columns": Math.min(2, stats.length),
  } as CSSProperties;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="card-detail-title"
        aria-modal="true"
        className={`card-dialog card-dialog--${card.faction}`}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <p className="dialog-kicker">
              {typeLabels[card.type]} · {item.isCommander ? "指挥官卡" : `预组 ×${item.quantity}`}
            </p>
            <h2 id="card-detail-title">{card.name}</h2>
            <span className="card-id">{card.id}</span>
          </div>
          <button autoFocus className="close-button" onClick={onClose} type="button">
            <span aria-hidden="true">×</span>
            <span className="sr-only">关闭卡牌详情</span>
          </button>
        </header>

        <dl className="stat-grid" style={statGridStyle}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>

        <div className="effect-section">
          <h3>卡牌规则</h3>
          {effects.length === 0 ? (
            <p className="empty-effect">此卡没有额外能力。</p>
          ) : (
            effects.map((effect) => (
              <article className="effect-card" key={effect.id}>
                <div className="effect-heading">
                  <span>{effectTypeLabel(effect.category)}</span>
                </div>
                <p className="effect-text">{effect.text}</p>
                <dl className="effect-meta">
                  <div>
                    <dt>时机</dt>
                    <dd>{effect.timing}</dd>
                  </div>
                  {effect.target ? (
                    <div>
                      <dt>目标</dt>
                      <dd>{effect.target}</dd>
                    </div>
                  ) : null}
                  {effect.usageLimit ? (
                    <div>
                      <dt>限制</dt>
                      <dd>{effect.usageLimit}</dd>
                    </div>
                  ) : null}
                  {effect.duration ? (
                    <div>
                      <dt>持续</dt>
                      <dd>{effect.duration}</dd>
                    </div>
                  ) : null}
                </dl>
                {effect.notes ? <p className="rule-note">规则注记：{effect.notes}</p> : null}
              </article>
            ))
          )}
        </div>

        {card.notes ? <p className="design-note">设计备注：{card.notes}</p> : null}
      </section>
    </div>
  );
}
