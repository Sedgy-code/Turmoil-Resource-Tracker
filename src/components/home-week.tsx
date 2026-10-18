"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Backpack, BarChart3, Check, CheckCircle2, ChevronDown, ChevronsUp, Clock, FlaskConical, Sparkles, Swords, Target, X } from "lucide-react";
import { ASCENSION_PILLARS, ASCENSIONS_UPDATED, PILLAR_LABELS } from "@/lib/ascension";
import { countdown, raceEnd, warDay, warWeekOf, WAR_DAYS } from "@/lib/war-calendar";
import { currentWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { AscensionPillar, AscensionsResponse, DashboardResponse, DewResponse, SnipePlan, SnipesResponse } from "@/lib/types";
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

/** Sends JSON to the hub; throws the hub's own message when it says no. */
async function send<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result as T;
}

/**
 * Home, built for phones: the jobs every member has each week (save resources, say whether they're
 * ascending, answer the next snipe), then what to do in the war today. The rest is for the curious.
 */
export function HomeWeek({ data, notify, between }: { data: DashboardResponse; notify: (message: string, error?: boolean) => void; between?: ReactNode }) {
  const t = useT();
  const now = useNow();
  const me = data.currentUser;
  const [earned, setEarned] = useState<boolean | null>(null);
  const [plans, setPlans] = useState<SnipePlan[] | null>(null);
  const [ascension, setAscension] = useState<AscensionPillar[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [dew, snipes, ascensions] = await Promise.all([
      load<DewResponse>("/api/dew"), load<SnipesResponse>("/api/snipes"), load<AscensionsResponse>("/api/ascensions"),
    ]);
    if (dew) setEarned(dew.resourceRewardEarned);
    if (snipes) setPlans(snipes.plans);
    if (ascensions) setAscension(ascensions.mine);
  }, []);
  useEffect(() => {
    void refresh();
    // Phones keep the app open in the background: catch up when it comes back.
    const again = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [refresh]);
  const fail = (e: unknown) => {
    const text = e instanceof Error ? e.message : "Please try again.";
    notify(t(text), true);
  };

  // Job 1: a complete save this clan week (Monday to Monday, UTC) earns the weekly Clan Points.
  const week = currentWeek(now);
  const ownEntry = data.entries.find((entry) => entry.memberId === me.id);
  const saved = earned ?? (!!ownEntry && currentWeek(new Date(ownEntry.updatedAt)) === week);
  const war = warDay(now);
  const saveHint = saved
    ? t("You earned 20 Clan Points.")
    : war.day === 7
      ? t("Earn 20 Clan Points. Please save before Day 1 starts, in {time}.", { time: countdown(war.nextDay, now) })
      : t("Earn 20 Clan Points. The week closes in {time}.", { time: countdown(raceEnd(now), now) });
  const savedThisWeek = data.entries.filter((entry) => currentWeek(new Date(entry.updatedAt)) === week).length;
  const total = data.stats.totalMembers;

  // Job 2: are you ascending this week, and what? (No is an answer too.)
  const answered = ascension !== undefined && ascension !== null;
  const ascensionTitle = !answered
    ? t("Are you ascending this week?")
    : ascension.length
      ? t("Ascending: {what}", { what: ascension.map((pillar) => t(PILLAR_LABELS[pillar])).join(", ") })
      : t("Not ascending this week");
  async function ascend(next: AscensionPillar[]) {
    const before = ascension;
    setAscension(next);
    try {
      setAscension((await send<AscensionsResponse>("/api/ascensions", "PUT", { pillars: next })).mine);
      window.dispatchEvent(new Event(ASCENSIONS_UPDATED));
    } catch (e) {
      setAscension(before);
      fail(e);
    }
  }
  const togglePillar = (pillar: AscensionPillar) => {
    const current = ascension ?? [];
    return current.includes(pillar) ? current.filter((item) => item !== pillar) : [...current, pillar];
  };

  // Job 3: answer the next snipe (the first one still waiting for an answer).
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
      const updated = (await send<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/response`, "POST", { answer: value })).plan;
      setPlans((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? current);
      notify(t("Answer saved."));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const allDone = earned === true && answered && (!snipe || !!answer);

  return <div className="home-week">
    <section className="home-card home-jobs-card" aria-labelledby="home-jobs-title">
      <div className="home-card-head">
        <h2 id="home-jobs-title">{t("Your jobs this week")}</h2>
        {allDone && <span className="home-done"><CheckCircle2 size={15} />{t("All done!")}</span>}
      </div>
      <ol className="home-jobs">
        <li className={`home-job${saved ? " done with-side" : ""}`}>
          <span className="home-job-mark" aria-hidden="true">{saved ? <Check size={17} /> : <Backpack size={16} />}</span>
          <div className="home-job-text">
            <strong>{saved ? t("Resources saved") : t("Save your resources")}</strong>
            <small>{saveHint}</small>
          </div>
          {saved
            ? <Link className="home-job-side" href="/resources">{t("Change")}</Link>
            : <Link className="button primary home-job-action" href="/resources">{ownEntry ? t("Update my resources") : t("Add my resources")}<ArrowRight size={16} /></Link>}
        </li>
        {ascension !== undefined && <li className={`home-job${answered ? " done" : ""}`}>
          <span className="home-job-mark" aria-hidden="true">{answered ? <Check size={17} /> : <ChevronsUp size={17} />}</span>
          <div className="home-job-text">
            <strong>{ascensionTitle}</strong>
            {!answered && <small>{t("Tap what you’re ascending, or No.")}</small>}
          </div>
          <div className="home-chips" role="group" aria-label={t("Are you ascending this week?")}>
            <button aria-pressed={answered && ascension.length === 0} onClick={() => void ascend([])}>{t("No")}</button>
            {ASCENSION_PILLARS.map((pillar) => <button key={pillar} aria-pressed={!!ascension?.includes(pillar)} onClick={() => void ascend(togglePillar(pillar))}>
              {t(PILLAR_LABELS[pillar])}
            </button>)}
          </div>
        </li>}
        {snipe && <li className={`home-job${answer ? " done" : ""}`}>
          <span className="home-job-mark" aria-hidden="true">{answer ? <Check size={17} /> : <Target size={16} />}</span>
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
    {between}
    <HomeToday now={now} />
  </div>;
}

/** Asks the folded clan totals further down Home to open. */
const OPEN_TOTALS = "turmoil-open-totals";

/** The clan's combined war estimate, kept short so it can sit between the jobs and today's plan. */
export function HomeArsenal({ minimum, maximum }: { minimum: number | null; maximum: number | null }) {
  const t = useT();
  const amount = (value: number | null) => value === null ? "--" : numberFormat(Math.round(value));
  return <section className="home-card home-arsenal" aria-labelledby="home-arsenal-title">
    <div className="home-card-head">
      <h2 id="home-arsenal-title" className="home-kicker"><Sparkles size={15} />{t("The clan’s current arsenal")}</h2>
      <span className="live-badge"><i />{t("LIVE TOTALS")}</span>
    </div>
    <p className="home-arsenal-range"><strong>{amount(minimum)}</strong><span aria-hidden="true">–</span><strong>{amount(maximum)}</strong></p>
    <div className="home-today-foot">
      <span className="home-today-time">{t("Total Potential War Points")}</span>
      <button type="button" className="home-link" onClick={() => window.dispatchEvent(new Event(OPEN_TOTALS))}>{t("Clan totals")}<ChevronDown size={14} /></button>
    </div>
  </section>;
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
    <p className="home-race">
      <FlaskConical size={15} />
      <span><strong>{t("Clan Tech Race")}</strong> · {t("Knock-out in {time}", { time: countdown(war.nextDay, now) })}<br />{t("In clan missions, pick Clan Tech Vials first.")}</span>
    </p>
    <div className="home-today-foot">
      <span className="home-today-time"><Clock size={13} />{war.day < 7
        ? t("Day {day} starts in {time}", { day: war.day + 1, time: countdown(war.nextDay, now) })
        : t("Next war starts in {time}", { time: countdown(war.weekEnd, now) })}</span>
      <Link className="home-link" href="/war">{t("See the war plan")}<ArrowRight size={14} /></Link>
    </div>
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
  const ref = useRef<HTMLDetailsElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    const show = () => {
      asked.current = true;
      setOpen(true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    window.addEventListener(OPEN_TOTALS, show);
    return () => window.removeEventListener(OPEN_TOTALS, show);
  }, []);
  return <details ref={ref} id="clan-totals" className="home-more" open={open} onToggle={(event) => {
    const next = event.currentTarget.open;
    setOpen(next);
    // Opening from the arsenal card is a one-off; only the fold's own button is remembered.
    if (asked.current) { asked.current = false; return; }
    try { window.localStorage.setItem(MORE_KEY, next ? "open" : "closed"); } catch { /* private mode */ }
  }}>
    <summary><BarChart3 size={17} /><span>{t("Clan totals")} · {t("Member contributions")}</span><ChevronDown size={16} className="home-more-chevron" /></summary>
    <div className="home-more-body">{children}</div>
  </details>;
}
