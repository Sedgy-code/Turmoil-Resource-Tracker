"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Crosshair, Trophy } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { useLanguage } from "@/lib/i18n";
import type { DashboardResponse } from "@/lib/types";
import { BOARDS, places, RankBadge } from "./contribution-cards";
import { useRecognition } from "./recognition";
import { RESOURCE_ICONS } from "./resource-icons";
import "./me-page.css";

/**
 * Where you stand: your place in the clan for each resource, in last war's points and in snipes,
 * pinned at the top of the Clan page and on your Me page, so you never scroll a board to find yourself.
 */
/** Big numbers stay short in a tile: 1,174,690 → 1.17M. */
function tileNumber(value: number, language: string): string {
  return value >= 1_000_000 ? new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 2 }).format(value) : numberFormat(value);
}

export function MyPlaces({ data, compact = false, title, action, footer }: {
  data: DashboardResponse;
  /** One line of chips (the Clan page) instead of a tile per resource with its number (Me). */
  compact?: boolean;
  title?: string;
  /** Beside the title, e.g. a link. */
  action?: ReactNode;
  footer?: ReactNode;
}) {
  const { t, language } = useLanguage();
  const me = data.currentUser.id;
  const { data: recognition } = useRecognition();
  const entries = new Map(data.entries.map((entry) => [entry.memberId, entry]));
  const saved = entries.has(me);
  const war = recognition?.latestWar?.points ?? {};
  const warRanks = places(data.members, (id) => war[id]);
  const warScorers = data.members.filter((member) => (war[member.id] ?? 0) > 0).length;
  const snipes = recognition?.snipes.recent[me] ?? 0;
  if (compact) {
    // One line of places (the boards below pin your row too): a picture and your place for each.
    const chips = [
      ...(saved ? BOARDS.map(({ key, label, tone }) => {
        const ranks = places(data.members, (id) => entries.get(id)?.resources[key]);
        return { key: String(key), label: t(label), tone, rank: ranks.get(me), count: ranks.size, Picture: RESOURCE_ICONS[key] };
      }) : []),
      { key: "war", label: t("Last war points"), tone: "gold", rank: warRanks.get(me), count: warScorers, Picture: Trophy },
    ];
    return <section className="home-card my-places compact" aria-labelledby="my-places-title">
      <div className="home-card-head">
        <h2 id="my-places-title">{title ?? t("Your places")}</h2>
        {action}
      </div>
      {!saved && <p className="my-places-empty">{t("Save your resources to see your place for each one.")} <Link href="/resources">{t("Add my resources")}</Link></p>}
      <ul className="my-places-chips">
        {chips.map(({ key, label, tone, rank, count, Picture }) => <li key={key} className={`my-place-chip tone-${tone}`}
          aria-label={rank === undefined ? `${label}: —` : `${label}: ${t("{rank} of {count}", { rank, count })}`} title={label}>
          <Picture size={22} aria-hidden="true" />
          <RankBadge rank={rank} />
        </li>)}
      </ul>
    </section>;
  }
  return <section className="home-card my-places" aria-labelledby="my-places-title">
    <div className="home-card-head">
      <h2 id="my-places-title">{title ?? t("Where you stand")}</h2>
      {action}
    </div>
    {!saved && <p className="my-places-empty">{t("Save your resources to see your place for each one.")} <Link href="/resources">{t("Add my resources")}</Link></p>}
    <ul className="my-places-grid">
      {saved && BOARDS.map(({ key, label, tone }) => {
        const Picture = RESOURCE_ICONS[key];
        const ranks = places(data.members, (id) => entries.get(id)?.resources[key]);
        const rank = ranks.get(me);
        return <li key={key} className={`my-place tone-${tone}`}>
          <Picture size={26} />
          <span className="my-place-text"><span>{t(label)}</span><strong>{tileNumber(entries.get(me)?.resources[key] ?? 0, language)}</strong></span>
          <span className="my-place-rank">
            <RankBadge rank={rank} />
            {rank !== undefined && <small>{t("of {count}", { count: ranks.size })}</small>}
          </span>
        </li>;
      })}
      <li className="my-place tone-gold">
        <Trophy size={24} aria-hidden="true" />
        <span className="my-place-text"><span>{t("Last war points")}</span><strong>{war[me] === undefined ? "—" : tileNumber(war[me], language)}</strong></span>
        <span className="my-place-rank">
          <RankBadge rank={warRanks.get(me)} />
          {warRanks.has(me) && <small>{t("of {count}", { count: warScorers })}</small>}
        </span>
      </li>
      <li className="my-place tone-ice">
        <Crosshair size={24} aria-hidden="true" />
        <span className="my-place-text"><span>{t("Snipes (8 wk)")}</span><strong>{numberFormat(snipes)}</strong></span>
      </li>
    </ul>
    {footer}
  </section>;
}
