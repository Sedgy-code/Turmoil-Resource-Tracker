"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Clock, Plus } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { WAR_DAYS, countdown, nextWarWeek, utcDateTime, warDay, warStart, warWeekOf } from "@/lib/war-calendar";
import { activityPoints, dayPoints, pillarCounts, rankPairs, twinDays, type DayPair } from "@/lib/clan-day-planner";
import { PILLAR_ICONS, RESOURCE_ICONS } from "./resource-icons";
import { PILLAR_LABELS } from "@/lib/ascension";
import { estimateWar, WAR_ACTIVITIES } from "@/lib/war";
import { useLanguage, useT, type Translate } from "@/lib/i18n";
import type { AscensionPillar, AscensionsResponse, ClanDayVotes, ClanDaysResponse, DashboardResponse, WarRates } from "@/lib/types";
import { NextWarVote } from "./next-war-vote";
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
  const [state, setState] = useState<{ week: string; days: number[]; failed?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/war-days?week=${week}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<ClanDaysResponse> : Promise.reject())
      .then((result) => { if (!cancelled) setState({ week, days: result.days }); })
      // Couldn't load: say so, rather than "Leadership hasn't picked the clan days yet".
      .catch(() => { if (!cancelled) setState({ week, days: [], failed: true }); });
    return () => { cancelled = true; };
  }, [week]);
  const loaded = state?.week === week;
  const days = loaded ? state!.days : [];
  const failed = loaded && !!state!.failed;
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
  return { days, loaded, failed, saving, save };
}

export type TodayTone = "on" | "hold" | "battle" | "claim";

/**
 * What the clan is doing today, in the same words on Home and on the War page: spend on a clan day,
 * hold on the other spending days, fight on Day 6, claim on Day 7. `clan` is this war's clan days
 * (on Day 7, the next war's). A hold day never shows the day's spending tip.
 */
export function todayAdvice(day: number, clan: { days: number[]; loaded: boolean; failed: boolean }, t: Translate): { tone: TodayTone | null; badge: string; main: string; sub: string } {
  if (day === 6) return { tone: "battle", badge: t("Battle"), main: t("Fight the other clans. Spending doesn't score today."), sub: "" };
  if (day === 7) {
    const sub = clan.days.length ? t("Next war’s clan days: {days}.", { days: clan.days.map((item) => t("Day {day}", { day: item })).join(", ") }) : "";
    return { tone: "claim", badge: t("Claim rewards"), main: t("Claim your war rewards. You only have today."), sub };
  }
  if (!clan.loaded) return { tone: null, badge: "", main: "…", sub: "" };
  if (clan.failed) return { tone: null, badge: "", main: t("Couldn’t load the clan days. Check your connection, then open this page again."), sub: "" };
  if (!clan.days.length) return { tone: null, badge: "", main: t("Leadership hasn’t picked the clan days yet. Check announcements before you spend."), sub: "" };
  if (clan.days.includes(day)) return { tone: "on", badge: t("Clan day"), main: t("Today is a clan day: spend your resources."), sub: t(WAR_DAYS[day - 1].tip) };
  const next = clan.days.find((item) => item > day);
  const sub = next ? t("Next clan day: Day {day}.", { day: next }) : t("No more clan days this war.");
  return { tone: "hold", badge: t("Hold"), main: t("Today is not a clan day: hold your resources."), sub };
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
  const { votes, vote } = useClanDayVotes(current.day >= 6);
  const voted = votes ? voteSummary(votes.counts, (day) => t("Day {day}", { day })) : "";
  // On Day 6 the picker above is still this war; the planner picks for the next one.
  const nextClan = useClanDays(nextWarWeek(now));
  async function toggle(day: number) {
    const next = clan.days.includes(day) ? clan.days.filter((item) => item !== day) : [...clan.days, day].sort((a, b) => a - b);
    if (!(await clan.save(next))) notify?.(t("Please try again."), true);
  }
  // Battle day: this war's days can no longer change; the planner below picks the next war's.
  const lockedToday = current.day === 6;
  // Today's card says what Home says, in the colour of the day: battle, clan day, hold or claim.
  const advice = todayAdvice(current.day, clan, t);
  return <div className="war-week">
    <section className={`panel war-week-now${advice.tone ? ` tone-${advice.tone}` : ""}`}>
      <div>
        <span className="war-week-kicker">{t("Today")}</span>
        <h2>{t("War Day {day} of 7", { day: current.day })}</h2>
        <p className="war-week-verdict">{advice.main}</p>
        {advice.sub && <p>{advice.sub}</p>}
      </div>
      <div className="war-week-timer"><Clock size={18} />{current.day < 7 ? t("Day {day} starts in {time}", { day: current.day + 1, time: countdown(current.nextDay, now) }) : t("Next war starts in {time}", { time: countdown(current.weekEnd, now) })}</div>
    </section>
    {/* Vote here too, not only on Home: wherever the counts show, so can the buttons. */}
    {votes?.open && <NextWarVote votes={votes} vote={vote} weekEnd={current.weekEnd} now={now} notify={notify} memberId={data.currentUser.id} />}
    <section className="panel war-clan-days">
      <h2>{t(planningNext ? "Clan days for the next war" : "Clan days this war")}</h2>
      <div className="war-clan-day-list">{SPENDING_DAYS.map((day) => {
        const chosen = clan.days.includes(day);
        return admin && !lockedToday
          ? <button key={day} className={`war-clan-day${chosen ? " on" : ""}`} aria-pressed={chosen} disabled={!clan.loaded || clan.saving} onClick={() => void toggle(day)}>
            {chosen ? <Check size={14} /> : <Plus size={14} />}{t("Day {day}", { day })}
            {planningNext && !!votes?.counts[day - 1] && <span className="war-clan-day-votes">{votes.counts[day - 1]}</span>}
          </button>
          : <span key={day} className={`war-clan-day${chosen ? " on" : ""}`}>{chosen && <Check size={14} />}{t("Day {day}", { day })}</span>;
      })}</div>
      {clan.loaded && <p>{clan.days.length ? t("Only spend on the clan days. Spending on other days earns a black mark.") : t("Leadership hasn’t picked the clan days yet. Check announcements before you spend.")}</p>}
      {admin && <p className="war-week-note">{lockedToday ? t("This war’s clan days are locked on battle day. Pick the next war’s days below.") : t("Tap the days the clan will spend on. Members see them straight away.")}</p>}
      {admin && voted && !votes?.picked.length && <p className="war-week-note war-clan-votes">🗳️ {t("Members’ votes for the next war: {votes}", { votes: voted })}</p>}
    </section>
    {admin && current.day >= 6 && <ClanDayPlanner data={data} rates={rates} votes={votes} target={planningNext ? clan : nextClan} week={nextWarWeek(now)} starts={current.weekEnd} now={now} notify={notify} />}
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
function ClanDayPlanner({ data, rates, votes, target, week, starts, now, notify }: {
  data: DashboardResponse;
  rates: WarRates;
  votes: ClanDayVotes | null;
  target: ReturnType<typeof useClanDays>;
  week: string;
  /** When the next war starts (00:00 UTC). */
  starts: Date;
  now: Date;
  notify?: (message: string, error?: boolean) => void;
}) {
  const { t, language } = useLanguage();
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
    <p className="war-planner-starts">{t("Next war starts {date}, in {time}.", { date: utcDateTime(starts.toISOString(), language), time: countdown(starts, now) })}</p>
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
