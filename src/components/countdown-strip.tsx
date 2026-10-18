"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Backpack, FlaskConical, Swords, Target } from "lucide-react";
import { countdown, raceEnd, warDay, warWeekOf, WAR_DAYS } from "@/lib/war-calendar";
import { currentWeek } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { SnipePlan, SnipesResponse } from "@/lib/types";
import { useClanDays, useNow } from "./war-week";
import "./war-week.css";

/** Today at a glance: war day, next snipe, tech race and the weekly save deadline (all in UTC). */
export function CountdownStrip({ lastSavedAt }: { lastSavedAt: string | null }) {
  const t = useT();
  const now = useNow();
  const [snipe, setSnipe] = useState<SnipePlan | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/snipes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<SnipesResponse> : Promise.reject())
      .then((result) => {
        if (cancelled) return;
        const upcoming = result.plans
          .filter((plan) => !plan.archived && new Date(plan.startsAt).getTime() > Date.now() - 3 * 3_600_000)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        setSnipe(upcoming[0] ?? null);
      })
      .catch(() => { if (!cancelled) setSnipe(null); });
    return () => { cancelled = true; };
  }, []);
  const war = warDay(now);
  const clan = useClanDays(warWeekOf(now));
  const clanToday = war.day <= 5 && clan.days.length > 0 ? clan.days.includes(war.day) : null;
  const savedThisWeek = !!lastSavedAt && currentWeek(new Date(lastSavedAt)) === currentWeek(now);
  const snipeStarts = snipe ? new Date(snipe.startsAt) : null;
  const activities = WAR_DAYS[war.day - 1].activities.map((activity) => t(activity)).join(" · ");
  return <section className="countdown-strip" aria-label={t("Coming up")}>
    <Link className="countdown-item" href="/war">
      <Swords size={20} />
      <div>
        <span>{t("Clan war")}</span>
        <strong>{t("Day {day} of 7", { day: war.day })}{clanToday !== null && <em className={`countdown-clan-day${clanToday ? " on" : ""}`}>{t(clanToday ? "Clan day" : "Hold")}</em>}</strong>
        <small title={activities}>{war.day < 7 ? t("Day {day} starts in {time}", { day: war.day + 1, time: countdown(war.nextDay, now) }) : t("Next war starts in {time}", { time: countdown(war.weekEnd, now) })}</small>
      </div>
    </Link>
    <Link className="countdown-item" href="/snipes">
      <Target size={20} />
      <div>
        <span>{t("Next snipe")}</span>
        <strong>{snipe ? snipe.title : snipe === null ? t("None planned") : "…"}</strong>
        {snipeStarts && <small>{snipeStarts.getTime() > now.getTime() ? t("Starts in {time}", { time: countdown(snipeStarts, now) }) : t("Happening now")}</small>}
      </div>
    </Link>
    <Link className="countdown-item" href="/vial-donations">
      <FlaskConical size={20} />
      <div>
        <span>{t("Clan Tech Race")}</span>
        <strong>{t("Knock-out in {time}", { time: countdown(war.nextDay, now) })}</strong>
        <small>{t("Race ends in {time}", { time: countdown(raceEnd(now), now) })}</small>
      </div>
    </Link>
    <Link className="countdown-item" href="/resources">
      <Backpack size={20} />
      <div>
        <span>{t("Your resources")}</span>
        <strong>{savedThisWeek ? t("Saved this week ✓") : t("Not saved this week")}</strong>
        <small>{t("Week closes in {time}", { time: countdown(raceEnd(now), now) })}</small>
      </div>
    </Link>
  </section>;
}
