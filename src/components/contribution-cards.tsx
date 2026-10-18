"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUp, CircleAlert, Clock, Trophy } from "lucide-react";
import { numberFormat, type ResourceKey } from "@/lib/resources";
import { PILLAR_LABELS } from "@/lib/ascension";
import { useT } from "@/lib/i18n";
import type { AscensionPillar, Member } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { RESOURCE_ICONS, type ResourcePicture } from "./resource-icons";
import "./contribution-cards.css";

/*
 * Member contributions as JBUC10 drew them: one glowing card per resource, in that resource's
 * colour, with the clan's top members by rank (gold, blue and bronze for the top three). Each card
 * shows the top 5 and your own place; "Show all" lists everyone. Searching or picking a group
 * (Updated, Pending, Ascending) lists every match.
 */

export type Tone = "green" | "gold" | "violet" | "ice" | "teal" | "pink" | "peach";

/** In the order of the My Resources form; colours match each resource's picture. */
export const BOARDS: { key: ResourceKey; label: string; tone: Tone }[] = [
  { key: "skillTickets", label: "Skill Tickets", tone: "green" },
  { key: "mountKeys", label: "Mount Keys", tone: "gold" },
  { key: "mountsToMerge", label: "Mounts to Merge", tone: "violet" },
  { key: "hammers", label: "Hammers", tone: "ice" },
  { key: "potions", label: "Clan Tech Vials", tone: "teal" },
  { key: "eggsPetsTotal", label: "Total eggs/pets", tone: "pink" },
  { key: "eggshellsTotal", label: "Eggshells total", tone: "peach" },
];

const TOP = 5;

type Metric = (memberId: string) => number | undefined;
type Direction = "desc" | "asc";

export interface ContributionData {
  /** Members in view, after the search and the group picked. */
  members: Member[];
  /** Everyone, so a member's rank is their place in the whole clan. */
  everyone: Member[];
  meId: string;
  /** A saved amount, or undefined when the member hasn't saved. */
  amount: (memberId: string, key: ResourceKey) => number | undefined;
  /** What the member still has to add for this resource ("" when nothing). */
  missing: (memberId: string, key: ResourceKey) => string;
  warPoints: Metric;
  /** When the member last saved (ms), for sorting by "Last updated". */
  updatedAt: Metric;
  updated: (memberId: string) => ReactNode;
  ascending: Map<string, AscensionPillar[]>;
  /** Admins can open a member's resources from their name. */
  editHref?: (memberId: string) => string;
  /** Searching or showing one group: list every match. */
  filtered: boolean;
}

/** Place in the clan for each member with more than 0 (equal amounts share a place). */
export function places(everyone: Member[], metric: Metric): Map<string, number> {
  const scored = everyone
    .map((member) => ({ id: member.id, value: metric(member.id) }))
    .filter((item): item is { id: string; value: number } => item.value !== undefined && item.value > 0)
    .sort((a, b) => b.value - a.value);
  const result = new Map<string, number>();
  scored.forEach((item, index) => {
    const previous = scored[index - 1];
    result.set(item.id, previous && previous.value === item.value ? result.get(previous.id)! : index + 1);
  });
  return result;
}

/** Sorted by the metric; members without a number always go last. */
function order(members: Member[], metric: Metric, direction: Direction): Member[] {
  return [...members].sort((a, b) => {
    const av = metric(a.id), bv = metric(b.id);
    if (av === undefined) return bv === undefined ? a.username.localeCompare(b.username) : 1;
    if (bv === undefined) return -1;
    return (direction === "desc" ? bv - av : av - bv) || a.username.localeCompare(b.username);
  });
}

export function ContributionCards(props: ContributionData) {
  return (
    <div className="contrib-boards">
      {BOARDS.map((board) => (
        <ResourceBoard key={board.key} resource={board.key} label={board.label} tone={board.tone} data={props} />
      ))}
      <ActivityBoard data={props} />
    </div>
  );
}

/** A member's place: gold with a crown, blue and bronze for the top three, then plain numbers. */
export function RankBadge({ rank }: { rank: number | undefined }) {
  if (rank === undefined) return <span className="contrib-rank none" aria-hidden="true">–</span>;
  if (rank > 3) return <span className="contrib-rank">{rank}</span>;
  return (
    <span className={`contrib-rank medal m${rank}`}>
      {rank === 1 && (
        <svg className="contrib-crown" viewBox="0 0 24 14" aria-hidden="true" focusable="false">
          <path d="M2 12.5 1 2.5l6 4.5L12 0l5 7 6-4.5-1 10Z" />
        </svg>
      )}
      {rank}
    </span>
  );
}

function MemberCell({ member, data }: { member: Member; data: ContributionData }) {
  const t = useT();
  const pillars = data.ascending.get(member.id);
  const name = <MemberName member={member} />;
  return (
    <span className="contrib-member">
      <MemberAvatar member={member} small />
      {data.editHref ? <Link className="contrib-name" href={data.editHref(member.id)}>{name}</Link> : <span className="contrib-name">{name}</span>}
      {member.id === data.meId && <span className="you-badge">{t("you")}</span>}
      {pillars && (
        <ChevronsUp
          size={14}
          className="contrib-ascending"
          aria-label={t("Ascending: {what}", { what: pillars.map((pillar) => t(PILLAR_LABELS[pillar])).join(", ") })}
        />
      )}
    </span>
  );
}

/** The rows a card shows: the top 5 and your own place, or everyone. */
function useRows(data: ContributionData, metric: Metric, direction: Direction) {
  const [all, setAll] = useState(false);
  const rows = order(data.members, metric, direction);
  const everyone = data.filtered || all;
  const shown = everyone ? rows : rows.slice(0, TOP);
  const me = everyone || shown.some((member) => member.id === data.meId) ? undefined : rows.find((member) => member.id === data.meId);
  return { rows, shown, me, all, setAll, canExpand: !data.filtered && rows.length > TOP };
}

function MoreButton({ count, all, onClick }: { count: number; all: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className={`contrib-more${all ? " open" : ""}`} aria-expanded={all} onClick={onClick}>
      {all ? t("Show the top 5") : t("Show all {count}", { count })}
      <ChevronDown size={16} aria-hidden="true" />
    </button>
  );
}

function ResourceBoard({ resource, label, tone, data }: { resource: ResourceKey; label: string; tone: Tone; data: ContributionData }) {
  const t = useT();
  const id = useId();
  const Picture: ResourcePicture = RESOURCE_ICONS[resource];
  const [direction, setDirection] = useState<Direction>("desc");
  const metric: Metric = (memberId) => data.amount(memberId, resource);
  const ranks = places(data.everyone, metric);
  const { rows, shown, me, all, setAll, canExpand } = useRows(data, metric, direction);
  const row = (member: Member, extra = "") => {
    const value = metric(member.id);
    const missing = data.missing(member.id, resource);
    const rank = ranks.get(member.id);
    return (
      <li key={member.id} className={`contrib-row${rank === 1 ? " top" : ""}${member.id === data.meId ? " me" : ""}${extra}`}>
        <RankBadge rank={rank} />
        <MemberCell member={member} data={data} />
        <span className={`contrib-value${missing ? " missing" : ""}`} title={missing ? t("Missing: {fields}", { fields: missing }) : undefined}>
          {missing && <CircleAlert size={12} aria-label={t("Missing: {fields}", { fields: missing })} />}
          {value === undefined ? "—" : numberFormat(value)}
        </span>
      </li>
    );
  };
  return (
    <section className={`contrib-board tone-${tone}`} aria-labelledby={`${id}-title`}>
      <div className="contrib-head">
        <span aria-hidden="true">#</span>
        <span>{t("Member")}</span>
        <button
          type="button"
          className="contrib-sort"
          onClick={() => setDirection(direction === "desc" ? "asc" : "desc")}
          aria-label={`${t(label)}: ${direction === "desc" ? t("Most first") : t("Least first")}`}
        >
          <Picture size={28} />
          <strong id={`${id}-title`}>{t(label)}</strong>
          {direction === "desc" ? <ArrowDown size={15} aria-hidden="true" /> : <ArrowUp size={15} aria-hidden="true" />}
        </button>
      </div>
      <ol className="contrib-rows">
        {shown.map((member) => row(member))}
        {me && <>
          <li className="contrib-gap" aria-hidden="true">⋯</li>
          {row(me)}
        </>}
      </ol>
      {canExpand && <MoreButton count={rows.length} all={all} onClick={() => setAll(!all)} />}
    </section>
  );
}

/** Last war points and when each member last saved: who's active, and who to chase. */
function ActivityBoard({ data }: { data: ContributionData }) {
  const t = useT();
  const id = useId();
  const [sort, setSort] = useState<{ key: "war" | "updated"; direction: Direction }>({ key: "war", direction: "desc" });
  const ranks = places(data.everyone, data.warPoints);
  const metric = sort.key === "war" ? data.warPoints : data.updatedAt;
  const { rows, shown, me, all, setAll, canExpand } = useRows(data, metric, sort.direction);
  const pick = (key: "war" | "updated") => setSort((old) => old.key === key
    ? { key, direction: old.direction === "desc" ? "asc" : "desc" }
    // Last updated starts with the oldest save: the members to remind.
    : { key, direction: key === "updated" ? "asc" : "desc" });
  const arrow = (key: "war" | "updated") => sort.key !== key ? null
    : sort.direction === "desc" ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />;
  const row = (member: Member) => {
    const points = data.warPoints(member.id);
    const rank = ranks.get(member.id);
    return (
      <li key={member.id} className={`contrib-row${rank === 1 ? " top" : ""}${member.id === data.meId ? " me" : ""}`}>
        <RankBadge rank={rank} />
        <MemberCell member={member} data={data} />
        <span className="contrib-value war">{points === undefined ? "—" : numberFormat(points)}</span>
        <span className="contrib-updated">{data.updated(member.id)}</span>
      </li>
    );
  };
  return (
    <section className="contrib-board contrib-activity tone-gold" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="visually-hidden">{t("Last war points")} · {t("Last updated")}</h3>
      <div className="contrib-head">
        <span aria-hidden="true">#</span>
        <span>{t("Member")}</span>
        <button type="button" className={`contrib-sort stacked${sort.key === "war" ? " on" : ""}`} onClick={() => pick("war")}>
          <Trophy size={18} aria-hidden="true" /><span><strong>{t("Last war points")}</strong>{arrow("war")}</span>
        </button>
        <button type="button" className={`contrib-sort stacked${sort.key === "updated" ? " on" : ""}`} onClick={() => pick("updated")}>
          <Clock size={17} aria-hidden="true" /><span><strong>{t("Last updated")}</strong>{arrow("updated")}</span>
        </button>
      </div>
      <ol className="contrib-rows">
        {shown.map(row)}
        {me && <>
          <li className="contrib-gap" aria-hidden="true">⋯</li>
          {row(me)}
        </>}
      </ol>
      {canExpand && <MoreButton count={rows.length} all={all} onClick={() => setAll(!all)} />}
    </section>
  );
}
