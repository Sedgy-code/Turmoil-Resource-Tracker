"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Clock, Plus } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { WAR_DAYS, countdown, nextWarWeek, warDay, warStart, warWeekOf } from "@/lib/war-calendar";
import { activityPoints, dayPoints, pillarCounts, rankPairs, twinDays, type DayPair } from "@/lib/clan-day-planner";
import { PILLAR_ICONS, RESOURCE_ICONS } from "./resource-icons";
import { PILLAR_LABELS } from "@/lib/ascension";
import { estimateWar, WAR_ACTIVITIES } from "@/lib/war";
import { useT } from "@/lib/i18n";
import type { AscensionPillar, AscensionsResponse, ClanDayVotes, ClanDaysResponse, DashboardResponse, WarRates } from "@/lib/types";
import "./war-week.css";

const RESOURCE_LABELS = {
  hammers: "Hammers",
  skillTickets: "Skill Tickets",
  mountKeys: "Mount Keys",
  mountsToMerge: "Mounts to Merge",
  eggsPetsTotal: "Total eggs/pets",
  eggshellsTotal: "Eggshells total",
} as const;

/** Re-renders every 30 seconds so countdowns stay current. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const SPENDING_DAYS = [1, 2, 3, 4, 5];

/** The clan days leadership picked for one war, and (for admins) a way to change them. */
export function useClanDays(week: string) {
  const [state, setState] = useState<{ week: string; days: number[] } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/war-days?week=${week}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ClanDaysResponse> : Promise.reject())
      .then((result) => { if (!cancelled) setState({ week, days: result.days }); })
      .catch(() => { if (!cancelled) setState({ week, days: [] }); });
    return () => { cancelled = true; };
  }, [week]);
  const loaded = state?.week === week;
  const days = loaded ? state!.days : [];
  async function save(next: number[]): Promise<boolean> {
    setState({ week, days: next });
    setSaving(true);
    try {
      const response = await fetch("/api/war-days", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week, days: next }) });
      if (!response.ok) throw new Error();
      setState({ week, days: ((await response.json()) as ClanDaysResponse).days });
      return true;
    } catch {
      setState({ week, days });
      return false;
    } finally { setSaving(false); }
  }
  return { days, loaded, saving, save };
}

/**
 * Members' votes for the next war's clan days (open on Days 6 and 7 until leadership picks).
 * Only loaded on those days; `vote` saves your days and says whether it failed or earned Clan Points.
 */
export function useClanDayVotes(enabled: boolean) {
  const [votes, setVotes] = useState<ClanDayVotes | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => fetch("/api/war-days/votes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ClanDayVotes> : Promise.reject())
      .then((result) => { if (!cancelled) setVotes(result); })
      .catch(() => { /* keep what we have */ });
    void load();
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", again); };
  }, [enabled]);
  async function vote(days: number[]): Promise<{ error: string | null; rewarded: boolean }> {
    const response = await fetch("/api/war-days/votes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { error: (result as { error?: string }).error || "Please try again.", rewarded: false };
    setVotes(result as ClanDayVotes);
    return { error: null, rewarded: !!(result as ClanDayVotes).rewarded };
  }
  return { votes: enabled ? votes : null, vote };
}

/** "Day 1 (8), Day 3 (6)": the days members voted for, most votes first. */
export function voteSummary(counts: number[], dayLabel: (day: number) => string): string {
  return counts.map((count, index) => ({ day: index + 1, count })).filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.day - b.day).map((item) => `${dayLabel(item.day)} (${item.count})`).join(", ");
}

export function WarWeek({ data, rates, admin = false, notify }: { data: DashboardResponse; rates: WarRates; admin?: boolean; notify?: (message: string, error?: boolean) => void }) {
  const t = useT();
  const now = useNow();
  const current = warDay(now);
  const start = warStart(now);
  // On Day 7 (claim rewards) the war is over, so leadership is picking days for the next one.
  const planningNext = current.day === 7;
  const clan = useClanDays(warWeekOf(planningNext ? new Date(now.getTime() + 86_400_000) : now));
  const { votes } = useClanDayVotes(current.day >= 6);
  const voted = votes ? voteSummary(votes.counts, (day) => t("Day {day}", { day })) : "";
  // On Day 6 the picker above is still this war; the planner picks for the next one.
  const nextClan = useClanDays(nextWarWeek(now));
  async function toggle(day: number) {
    const next = clan.days.includes(day) ? clan.days.filter((item) => item !== day) : [...clan.days, day].sort((a, b) => a - b);
    if (!(await clan.save(next))) notify?.(t("Please try again."), true);
  }
  // Today's card takes the colour of the day, as on Home: battle red, clan day gold, hold orange, claim green.
  const tone = current.day === 6 ? "battle" : current.day === 7 ? "claim"
    : !clan.loaded || !clan.days.length ? "" : clan.days.includes(current.day) ? "on" : "hold";
  return <div className="war-week">
    <section className={`panel war-week-now${tone ? ` tone-${tone}` : ""}`}>
      <div>
        <span className="war-week-kicker">{t("Today")}</span>
        <h2>{t("War Day {day} of 7", { day: current.day })}</h2>
        <p>{t(WAR_DAYS[current.day - 1].tip)}</p>
      </div>
      <div className="war-week-timer"><Clock size={18} />{current.day < 7 ? t("Day {day} starts in {time}", { day: current.day + 1, time: countdown(current.nextDay, now) }) : t("Next war starts in {time}", { time: countdown(current.weekEnd, now) })}</div>
    </section>
    <section className="panel war-clan-days">
      <h2>{t(planningNext ? "Clan days for the next war" : "Clan days this war")}</h2>
      <div className="war-clan-day-list">{SPENDING_DAYS.map((day) => {
        const chosen = clan.days.includes(day);
        return admin
          ? <button key={day} className={`war-clan-day${chosen ? " on" : ""}`} aria-pressed={chosen} disabled={!clan.loaded || clan.saving} onClick={() => void toggle(day)}>
            {chosen ? <Check size={14} /> : <Plus size={14} />}{t("Day {day}", { day })}
            {planningNext && !!votes?.counts[day - 1] && <span className="war-clan-day-votes">{votes.counts[day - 1]}</span>}
          </button>
          : <span key={day} className={`war-clan-day${chosen ? " on" : ""}`}>{chosen && <Check size={14} />}{t("Day {day}", { day })}</span>;
      })}</div>
      {clan.loaded && <p>{clan.days.length ? t("Only spend on the clan days. Spending on other days earns a black mark.") : t("Leadership hasn’t picked the clan days yet. Check announcements before you spend.")}</p>}
      {admin && <p className="war-week-note">{t("Tap the days the clan will spend on. Members see them straight away.")}</p>}
      {voted && !votes?.picked.length && <p className="war-week-note war-clan-votes">🗳️ {t("Members’ votes for the next war: {votes}", { votes: voted })}</p>}
    </section>
    {admin && current.day >= 6 && <ClanDayPlanner data={data} rates={rates} votes={votes} target={planningNext ? clan : nextClan} week={nextWarWeek(now)} notify={notify} />}
    <p className="war-week-note">{t("Each war day starts at 00:00 UTC. Leadership may ask you to hold resources for a snipe, so check announcements before you spend.")}</p>
    <div className="war-week-grid">
      {WAR_DAYS.map((entry) => {
        const date = new Date(start.getTime() + (entry.day - 1) * 86_400_000);
        const state = entry.day < current.day ? "done" : entry.day === current.day ? "today" : "later";
        return <article key={entry.day} className={`panel war-day war-day-${state}`}>
          <header>
            <strong>{t("Day {day}", { day: entry.day })}</strong>
            <span>{date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
            {state === "done" && <CheckCircle2 size={16} aria-label={t("Finished")} />}
            {state === "today" && <em>{t("Today")}</em>}
          </header>
          {!planningNext && clan.days.length > 0 && entry.day <= 5 && (clan.days.includes(entry.day)
            ? <span className="war-day-badge clan">{t("Clan day")}</span>
            : <span className="war-day-badge hold">{t("Hold")}</span>)}
          <ul className="war-day-activities">{entry.activities.map((activity) => <li key={activity}>{t(activity)}</li>)}</ul>
          {entry.resources.length > 0 && <dl className="war-day-clan">
            <dt>{t("Clan has")}</dt>
            {entry.resources.map((key) => { const Picture = RESOURCE_ICONS[key]; return <dd key={key}><span><Picture size={18} />{t(RESOURCE_LABELS[key as keyof typeof RESOURCE_LABELS])}</span><b>{numberFormat(data.totals[key] ?? 0)}</b></dd>; })}
          </dl>}
        </article>;
      })}
    </div>
    <Link className="war-week-link" href="/war-points">{t("Estimate the clan’s war points")} <ArrowRight size={14} /></Link>
  </div>;
}

const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));

/**
 * Leadership's helper for picking the next war's two clan days (Day 6 is always fought): every pair
 * of days ranked by the clan's saved resources, with members' votes and who is ascending what.
 */
function ClanDayPlanner({ data, rates, votes, target, week, notify }: {
  data: DashboardResponse;
  rates: WarRates;
  votes: ClanDayVotes | null;
  target: ReturnType<typeof useClanDays>;
  week: string;
  notify?: (message: string, error?: boolean) => void;
}) {
  const t = useT();
  const [ascending, setAscending] = useState<Partial<Record<AscensionPillar, number>>>({});
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ascensions?week=${week}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<AscensionsResponse> : Promise.reject())
      .then((result) => { if (!cancelled) setAscending(pillarCounts(result.ascending)); })
      .catch(() => { /* shown without ascending */ });
    return () => { cancelled = true; };
  }, [week]);
  const points = useMemo(() => {
    try { return activityPoints(estimateWar(data.entries, rates, WAR_ACTIVITIES.map(({ key }) => key), "current")); }
    catch { return activityPoints(null); }
  }, [data.entries, rates]);
  const pairs = rankPairs(points, votes?.pairs ?? {}, ascending);
  const mostVoted = pairs.reduce<DayPair | null>((best, pair) => pair.votes > (best?.votes ?? 0) ? pair : best, null);
  const shown = pairs.slice(0, 4);
  if (mostVoted && !shown.includes(mostVoted)) shown.push(mostVoted);
  // Bars are measured against the strongest single day, so both days of every pair compare.
  const strongest = Math.max(1, ...shown.flatMap((pair) => pair.perDay));
  const day = (value: number) => t("Day {day}", { day: value });
  async function pick(pair: DayPair) {
    if (await target.save(pair.days)) notify?.(t("Clan days saved."));
    else notify?.(t("Please try again."), true);
  }
  return <section className="panel war-planner" aria-labelledby="war-planner-title">
    <h2 id="war-planner-title">🧮 {t("Pick the next war’s clan days")}</h2>
    <p className="war-week-note">{t("Day 6 is always fought, so the clan needs 2 more days. Both have to be won, so pairs are ranked by their weaker day, then by the stronger one. Resources that score on both days (like hammers) are split between them.")}</p>
    <ol className="war-pairs">{shown.map((pair, index) => {
      const chosen = target.days.length === 2 && target.days[0] === pair.days[0] && target.days[1] === pair.days[1];
      const boosts = Object.entries(pair.ascending) as [AscensionPillar, number][];
      return <li key={pair.days.join(",")} className={chosen ? "on" : undefined}>
        <div className="war-pair-head">
          <div className="war-pair-title">
            <strong>{day(pair.days[0])} + {day(pair.days[1])}</strong>
            {index === 0 && <span className="war-pair-tag">★ {t("Strongest")}</span>}
            {pair === mostVoted && <span className="war-pair-tag vote">🗳️ {t("Most votes")}</span>}
          </div>
          <button className={`button ${chosen ? "primary" : "secondary"} small-button war-pair-pick`} disabled={!target.loaded || target.saving || chosen} onClick={() => void pick(pair)}>{chosen && <Check size={13} />}{chosen ? t("Picked") : t("Pick")}</button>
        </div>
        {/* Each day's points in this pair: the shorter bar is the day the clan is most likely to lose. */}
        <dl className="war-pair-days">
          {pair.days.map((value, side) => <div key={value} className={pair.perDay[side] === pair.weaker ? "weaker" : undefined}>
            <dt>{day(value)}</dt>
            <dd className="war-pair-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, (pair.perDay[side] / strongest) * 100)}%` }} /></dd>
            <dd>{t("about {points}", { points: compact(pair.perDay[side]) })}</dd>
          </div>)}
        </dl>
        <small>
          {t("Votes: {count}", { count: pair.votes })}
          {boosts.length > 0 && <> · <span className="war-pair-ascending">{t("Ascending")}:{boosts.map(([pillar, count]) => { const Picture = PILLAR_ICONS[pillar]; return <span key={pillar} title={t(PILLAR_LABELS[pillar])}><Picture size={16} />{count}</span>; })}</span></>}
        </small>
      </li>;
    })}</ol>
    {twinDays().map(([a, b]) => <p key={`${a},${b}`} className="war-week-note">{t("Days {a} and {b} use the same resources, so pairs with either one score the same.", { a, b })}</p>)}
    <p className="war-week-note">{t("Each day on its own: {days}", { days: dayPoints(points).map((value, index) => `${day(index + 1)} ${compact(value)}`).join(" · ") })}</p>
    <p className="war-week-note">{t("Counts hammers, skills, mounts and pets from saved resources. Forge, tech and dungeon points aren’t tracked.")}</p>
  </section>;
}
