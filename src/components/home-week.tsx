"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Backpack, BarChart3, Check, CheckCircle2, ChevronDown, Clock, FlaskConical, Swords, Target, X } from "lucide-react";
import { countdown, raceEnd, warDay, warWeekOf, WAR_DAYS } from "@/lib/war-calendar";
import { currentWeek } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { DashboardResponse, DewResponse, SnipePlan, SnipesResponse } from "@/lib/types";
import { useClanDays, useNow } from "./war-week";
import "./home-week.css";

const DAY = 86_400_000;

/** JSON from the hub, or null when it can't be loaded (the cards then show what they know). */
async function load<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

/**
 * Home, built for phones: the jobs every member has each week (save resources, answer the next
 * snipe), then what to do in the war today. Everything else on the hub is there for the curious.
 */
export function HomeWeek({ data, notify }: { data: DashboardResponse; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const now = useNow();
  const me = data.currentUser;
  const [earned, setEarned] = useState<boolean | null>(null);
  const [plans, setPlans] = useState<SnipePlan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [dew, snipes] = await Promise.all([load<DewResponse>("/api/dew"), load<SnipesResponse>("/api/snipes")]);
    if (dew) setEarned(dew.resourceRewardEarned);
    if (snipes) setPlans(snipes.plans);
  }, []);
  useEffect(() => {
    void refresh();
    // Phones keep the app open in the background: catch up when it comes back.
    const again = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [refresh]);

  // Job 1: a complete save this clan week (Monday to Monday, UTC) earns the weekly Clan Points.
  const week = currentWeek(now);
  const ownEntry = data.entries.find((entry) => entry.memberId === me.id);
  const saved = earned ?? (!!ownEntry && currentWeek(new Date(ownEntry.updatedAt)) === week);
  const war = warDay(now);
  const gapDay = war.day === 7;
  const saveHint = saved
    ? t("You earned 20 Clan Points. You can update your resources any time.")
    : gapDay
      ? t("Earn 20 Clan Points. Please save before Day 1 starts, in {time}.", { time: countdown(war.nextDay, now) })
      : t("Earn 20 Clan Points. The week closes in {time}.", { time: countdown(raceEnd(now), now) });
  const savedThisWeek = data.entries.filter((entry) => currentWeek(new Date(entry.updatedAt)) === week).length;
  const total = data.stats.totalMembers;

  // Job 2: answer the next snipe (the first one still waiting for an answer).
  const upcoming = (plans ?? [])
    .filter((plan) => !plan.archived && new Date(plan.startsAt).getTime() > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const answerOf = (plan: SnipePlan) => plan.responses.find((response) => response.memberId === me.id)?.answer;
  const snipe = upcoming.find((plan) => !answerOf(plan)) ?? upcoming[0] ?? null;
  const answer = snipe ? answerOf(snipe) : undefined;
  const snipeTitle = answer === "yes" ? t("You said Yes") : answer === "no" ? t("You said No") : t("Can you join this snipe?");
  async function respond(plan: SnipePlan, value: "yes" | "no") {
    setBusy(true);
    try {
      const response = await fetch(`/api/snipes/${plan.id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Please try again.");
      const updated = (result as { plan: SnipePlan }).plan;
      setPlans((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? current);
      notify(t("Answer saved."));
    } catch (e) {
      const text = e instanceof Error ? e.message : "Please try again.";
      notify(t(text), true);
    } finally {
      setBusy(false);
    }
  }
  const allDone = earned === true && (!snipe || !!answer);

  return <div className="home-week">
    <section className="home-card home-jobs-card" aria-labelledby="home-jobs-title">
      <div className="home-card-head">
        <h2 id="home-jobs-title">{t("Your jobs this week")}</h2>
        {allDone && <span className="home-done"><CheckCircle2 size={15} />{t("All done this week. Thank you!")}</span>}
      </div>
      <ol className="home-jobs">
        <li className={`home-job${saved ? " done" : ""}`}>
          <span className="home-job-mark" aria-hidden="true">{saved ? <Check size={18} /> : <Backpack size={17} />}</span>
          <div className="home-job-text">
            <strong>{saved ? t("Resources saved") : t("Save your resources")}</strong>
            <small>{saveHint}</small>
          </div>
          <Link className={`button ${saved ? "subtle" : "primary"} home-job-action`} href="/resources">
            {saved || ownEntry ? t("Update my resources") : t("Add my resources")}
            {!saved && <ArrowRight size={16} />}
          </Link>
        </li>
        {snipe && <li className={`home-job${answer ? " done" : ""}`}>
          <span className="home-job-mark" aria-hidden="true">{answer ? <Check size={18} /> : <Target size={17} />}</span>
          <div className="home-job-text">
            <strong>{snipeTitle}</strong>
            <small>{snipe.title} · {t("Starts in {time}", { time: countdown(new Date(snipe.startsAt), now) })}</small>
          </div>
          <div className="home-choice" role="group" aria-label={t("Can you join this snipe?")}>
            <button aria-pressed={answer === "yes"} disabled={busy} onClick={() => void respond(snipe, "yes")}><Check size={15} />{t("Yes")}</button>
            <button aria-pressed={answer === "no"} disabled={busy} onClick={() => void respond(snipe, "no")}><X size={15} />{t("No")}</button>
          </div>
        </li>}
      </ol>
      <div className="home-progress">
        <span>{t("{count} of {total} members saved this week", { count: savedThisWeek, total })}</span>
        <div className="home-track"><i style={{ width: `${total ? Math.min(100, (savedThisWeek / total) * 100) : 0}%` }} /></div>
      </div>
    </section>
    <HomeToday now={now} />
  </div>;
}

/** What the clan is doing in the war today: spend, hold, fight or claim. */
function HomeToday({ now }: { now: Date }) {
  const t = useT();
  const war = warDay(now);
  // On Day 7 the war is over, so the clan days shown are the next war's (as on War → This Week).
  const clan = useClanDays(warWeekOf(war.day === 7 ? new Date(now.getTime() + DAY) : now));
  let badge: { tone: "on" | "hold" | "battle" | "claim"; text: string } | null = null;
  let main = "";
  let sub = "";
  if (war.day <= 5) {
    if (!clan.loaded) main = "…";
    else if (!clan.days.length) main = t("Leadership hasn’t picked the clan days yet. Check announcements before you spend.");
    else if (clan.days.includes(war.day)) {
      badge = { tone: "on", text: `★ ${t("Clan day")}` };
      main = t("Today is a clan day: spend your resources.");
      sub = t(WAR_DAYS[war.day - 1].tip);
    } else {
      badge = { tone: "hold", text: `✋ ${t("Hold")}` };
      main = t("Today is not a clan day: hold your resources.");
      const next = clan.days.find((day) => day > war.day);
      sub = next ? t("Next clan day: Day {day}.", { day: next }) : t("No more clan days this war.");
    }
  } else if (war.day === 6) {
    badge = { tone: "battle", text: `⚔️ ${t("Battle")}` };
    main = t("Fight the other clans. Spending doesn't score today.");
  } else {
    badge = { tone: "claim", text: `🎁 ${t("Claim rewards")}` };
    main = t("Claim your war rewards. You only have today.");
    if (clan.days.length) sub = t("Next war’s clan days: {days}.", { days: clan.days.map((day) => t("Day {day}", { day })).join(", ") });
  }
  return <section className="home-card home-today" aria-labelledby="home-today-title">
    <div className="home-card-head">
      <h2 id="home-today-title" className="home-kicker"><Swords size={15} />{t("Today")} · {t("Day {day} of 7", { day: war.day })}</h2>
      {badge && <span className={`home-badge ${badge.tone}`}>{badge.text}</span>}
    </div>
    <p className="home-today-main">{main}</p>
    {sub && <p className="home-today-sub">{sub}</p>}
    <p className="home-today-time"><Clock size={14} />{war.day < 7
      ? t("Day {day} starts in {time}", { day: war.day + 1, time: countdown(war.nextDay, now) })
      : t("Next war starts in {time}", { time: countdown(war.weekEnd, now) })}</p>
    <p className="home-race">
      <FlaskConical size={16} />
      <span><strong>{t("Clan Tech Race")}</strong> · {t("Knock-out in {time}", { time: countdown(war.nextDay, now) })}<br />{t("In clan missions, pick Clan Tech Vials first.")}</span>
    </p>
    <Link className="home-link" href="/war">{t("See the war plan")}<ArrowRight size={15} /></Link>
  </section>;
}

const MORE_KEY = "turmoil-home-totals";

/** The clan's totals and every member's numbers, folded away so Home stays short on a phone. */
export function HomeMore({ children }: { children: ReactNode }) {
  const t = useT();
  // Folded on phones and open on wide screens, unless this device chose otherwise. It renders
  // after sign-in, so never on the server.
  const [open, setOpen] = useState(() => {
    try {
      const stored = window.localStorage.getItem(MORE_KEY);
      if (stored) return stored === "open";
    } catch { /* storage blocked: use the default */ }
    try { return window.matchMedia("(min-width: 900px)").matches; } catch { return false; }
  });
  return <details className="home-more" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next);
    try { window.localStorage.setItem(MORE_KEY, next ? "open" : "closed"); } catch { /* private mode */ }
  }}>
    <summary><BarChart3 size={17} /><span>{t("Clan totals")} · {t("Member contributions")}</span><ChevronDown size={16} className="home-more-chevron" /></summary>
    <div className="home-more-body">{children}</div>
  </details>;
}
