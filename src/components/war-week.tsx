"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { WAR_DAYS, countdown, warDay, warStart } from "@/lib/war-calendar";
import { useT } from "@/lib/i18n";
import type { DashboardResponse } from "@/lib/types";
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

export function WarWeek({ data }: { data: DashboardResponse }) {
  const t = useT();
  const now = useNow();
  const current = warDay(now);
  const start = warStart(now);
  return <div className="war-week">
    <section className="panel war-week-now">
      <div>
        <span className="war-week-kicker">{t("Today")}</span>
        <h2>{t("War Day {day} of 7", { day: current.day })}</h2>
        <p>{t(WAR_DAYS[current.day - 1].tip)}</p>
      </div>
      <div className="war-week-timer"><Clock size={18} />{current.day < 7 ? t("Day {day} starts in {time}", { day: current.day + 1, time: countdown(current.nextDay, now) }) : t("Next war starts in {time}", { time: countdown(current.weekEnd, now) })}</div>
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
