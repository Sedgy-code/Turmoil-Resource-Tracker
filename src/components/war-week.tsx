"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, Clock, Plus } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { WAR_DAYS, countdown, warDay, warStart, warWeekOf } from "@/lib/war-calendar";
import { useT } from "@/lib/i18n";
import type { ClanDayVotes, ClanDaysResponse, DashboardResponse } from "@/lib/types";
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

export function WarWeek({ data, admin = false, notify }: { data: DashboardResponse; admin?: boolean; notify?: (message: string, error?: boolean) => void }) {
  const t = useT();
  const now = useNow();
  const current = warDay(now);
  const start = warStart(now);
  // On Day 7 (claim rewards) the war is over, so leadership is picking days for the next one.
  const planningNext = current.day === 7;
  const clan = useClanDays(warWeekOf(planningNext ? new Date(now.getTime() + 86_400_000) : now));
  const { votes } = useClanDayVotes(current.day >= 6);
  const voted = votes ? voteSummary(votes.counts, (day) => t("Day {day}", { day })) : "";
  async function toggle(day: number) {
    const next = clan.days.includes(day) ? clan.days.filter((item) => item !== day) : [...clan.days, day].sort((a, b) => a - b);
    if (!(await clan.save(next))) notify?.(t("Please try again."), true);
  }
  return <div className="war-week">
    <section className="panel war-week-now">
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
            {entry.resources.map((key) => <dd key={key}><span>{t(RESOURCE_LABELS[key as keyof typeof RESOURCE_LABELS])}</span><b>{numberFormat(data.totals[key] ?? 0)}</b></dd>)}
          </dl>}
        </article>;
      })}
    </div>
    <Link className="war-week-link" href="/war-points">{t("Estimate the clan’s war points")} <ArrowRight size={14} /></Link>
  </div>;
}
