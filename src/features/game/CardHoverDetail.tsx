import {
  useId,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getOperatorArt } from "../../art/operatorArt";
import type { CardDefinition, GameContent } from "../../content";
import { effectTypeLabel } from "../cardPresentation";

const typeLabels = {
  commander: "指挥官",
  operator: "干员",
  tactical_support: "战术支援",
  field: "场地",
} as const;

const factionLabels = {
  rhodes_island: "罗德岛",
  reunion: "整合运动",
} as const;

interface CardHoverDetailProps {
  card: CardDefinition;
  children: ReactNode;
  className?: string;
  content: GameContent;
}

function CardEffects({ card, content }: { card: CardDefinition; content: GameContent }) {
  const effects = content.effects.filter((effect) => effect.cardId === card.id);
  return effects.length > 0 ? (
    <div className="operator-card__effects operator-card__effects--full">
      {effects.map((effect) => (
        <section key={effect.id}>
          <p>
            <strong className="operator-card__effect-type">
              {effectTypeLabel(effect.category)}
            </strong>
            <span>{effect.text}</span>
          </p>
          <small>
            时机：{effect.timing}
            {effect.usageLimit ? ` · 限制：${effect.usageLimit}` : ""}
            {effect.duration ? ` · 持续：${effect.duration}` : ""}
          </small>
        </section>
      ))}
    </div>
  ) : null;
}

function OperatorPreview({ card, content }: Pick<CardHoverDetailProps, "card" | "content">) {
  if (card.type !== "operator") return null;
  const artUrl = getOperatorArt(card.name, "Vertical");
  return (
    <div className={`card-tile card-tile--${card.faction} card-tile--operator card-hover-face`}>
      <div
        className={`operator-card__artwork${artUrl ? "" : " operator-card__artwork--placeholder"}`}
      >
        {artUrl ? (
          <video
            aria-hidden="true"
            autoPlay
            className="operator-card__art"
            loop
            muted
            playsInline
            preload="metadata"
            src={artUrl}
          />
        ) : (
          <span className="operator-card__placeholder-name">{card.name}</span>
        )}
        <div className="operator-card__art-overlay">
          <div className="operator-card__topline">
            <span>{card.position === "ground" ? "地面" : "高台"}</span>
            <strong>{factionLabels[card.faction]}</strong>
          </div>
          <div className="operator-card__identity">
            <span>{card.profession}</span>
            <h3>{card.name}</h3>
          </div>
          <dl className="operator-card__stats">
            <div><dt>DP</dt><dd>{card.cost}</dd></div>
            <div><dt>ATK</dt><dd>{card.atk}</dd></div>
            <div><dt>DEF</dt><dd>{card.def}</dd></div>
            <div><dt>HP</dt><dd>{card.life}</dd></div>
          </dl>
        </div>
      </div>
      <div className="operator-card__rules operator-card__rules--hover">
        <div className="operator-card__rules-heading">
          <small>撤退返费 {card.retreatRefund} · CD {card.redeployCd}</small>
        </div>
        <CardEffects card={card} content={content} />
      </div>
    </div>
  );
}

function OtherCardPreview({ card, content }: Pick<CardHoverDetailProps, "card" | "content">) {
  if (card.type === "operator") return null;
  const subtitle = card.type === "commander"
    ? `${card.initialShields} 点初始理智盾`
    : card.type === "tactical_support"
      ? card.supportKind === "instant" ? "即时型" : "持续型"
      : "共享场地";
  return (
    <div className={`card-tile card-tile--${card.faction} card-hover-face card-hover-face--other`}>
      <div className="card-tile__topline">
        <span>{typeLabels[card.type]}</span>
        <strong>{factionLabels[card.faction]}</strong>
      </div>
      <div className="card-tile__body">
        <h3>{card.name}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="card-tile__footer">
        <span>{"cost" in card ? `${card.cost} DP` : "—"}</span>
        <span>{card.id}</span>
      </div>
      <div className="card-hover-face__rules">
        <CardEffects card={card} content={content} />
      </div>
    </div>
  );
}

export function CardHoverDetail({
  card,
  children,
  className = "",
  content,
}: CardHoverDetailProps) {
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const show = (element: HTMLElement) => setAnchor(element.getBoundingClientRect());
  const hideAfterBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setAnchor(null);
    }
  };

  const tooltipStyle = (() => {
    if (!anchor) return undefined;
    const width = Math.min(360, window.innerWidth - 24);
    const rightSide = anchor.right + 12;
    const leftSide = anchor.left - width - 12;
    const left = rightSide + width <= window.innerWidth - 12
      ? rightSide
      : leftSide >= 12
        ? leftSide
        : Math.max(
            12,
            Math.min(window.innerWidth - width - 12, anchor.left + anchor.width / 2 - width / 2),
          );
    return {
      left,
      top: 12,
      maxHeight: window.innerHeight - 24,
    } satisfies CSSProperties;
  })();

  return (
    <div
      aria-describedby={anchor ? tooltipId : undefined}
      aria-label={`查看${card.name}详细信息`}
      className={`card-hover-target ${className}`.trim()}
      onBlur={hideAfterBlur}
      onFocus={(event) => show(event.currentTarget)}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      role="group"
      tabIndex={0}
    >
      {children}
      {anchor
        ? createPortal(
            <aside
              className="card-hover-detail card-hover-detail--catalog"
              data-testid="card-hover-detail"
              id={tooltipId}
              role="tooltip"
              style={tooltipStyle}
            >
              {card.type === "operator" ? (
                <OperatorPreview card={card} content={content} />
              ) : (
                <OtherCardPreview card={card} content={content} />
              )}
            </aside>,
            document.body,
          )
        : null}
    </div>
  );
}
