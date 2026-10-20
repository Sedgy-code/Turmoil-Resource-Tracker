"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronsUp, Clock, Gift, Hand, RefreshCw, ShieldCheck, Star, Swords, Target, X, type LucideProps } from "lucide-react";
import "@fontsource/knewave/400.css";
import { ASCENSION_PILLARS, ASCENSIONS_UPDATED, PILLAR_LABELS } from "@/lib/ascension";
import { countdown, raceEnd, warDay, warWeekOf } from "@/lib/war-calendar";
import { currentWeek } from "@/lib/resources";
import { useLanguage, useT } from "@/lib/i18n";
import type { AscensionPillar, AscensionsResponse, DashboardResponse, DewResponse, Member, SnipePlan, SnipesResponse } from "@/lib/types";
import { FoldButton, useFold } from "./home-fold";
import { TermHelp, WelcomeCard } from "./first-visit";
import { celebrate } from "./celebrate";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { checkInOpen } from "@/lib/snipe-calendar";
import { announceSnipeAnswered, displaySnipeTitle } from "@/lib/snipe-day";
import { CoinStack } from "./home-icons";
import { PILLAR_ICONS, VialIcon } from "./resource-icons";
import { MemberAvatar } from "./member-identity";
import { NextWarVote } from "./next-war-vote";
import { todayAdvice, useClanDayVotes, useClanDays, useNow, type TodayTone } from "./war-week";
import "./home-week.css";

const DAY = 86_400_000;

/** Stands in for a value while a translated sentence is split around it. */
const MARK = "\u0000";

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

/** "Hi, {name}" with the name in gold, wherever the language puts it. */
export function HomeGreeting({ name }: { name: string }) {
  const t = useT();
  const text = t("Hi, {name}", { name: MARK });
  const at = text.indexOf(MARK);
  if (at < 0) return <>{text} <span className="home-name">{name}</span></>;
  return <>{text.slice(0, at)}<span className="home-name">{name}</span>{text.slice(at + MARK.length)}</>;
}

/** A sentence with one number picked out in gold ("You earned 20 Clan Points."). */
function Gold({ text, value }: { text: string; value: string }) {
  const at = text.indexOf(value);
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<strong className="home-gold">{value}</strong>{text.slice(at + value.length)}</>;
}


/** The round picture at the start of each job; a green tick on it once the job is done. */
function JobMark({ tone, done, children }: { tone: "gold" | "slate"; done: boolean; children: ReactNode }) {
  return <span className={`home-job-mark ${tone}`} aria-hidden="true">
    {children}
    {done && <span className="home-tick"><Check size={11} strokeWidth={3.5} /></span>}
  </span>;
}

/**
 * Home, built for phones and kept short: what to do in the war today (spend or hold), the clan's
 * progress with the call to save, and the jobs every member has each week (save resources, say
 * whether they're ascending, answer the next snipe). A first-time member gets a welcome card on
 * top; leaders get their to-do card. The clan's totals and rankings live on the Clan tab.
 */
export function HomeWeek({ data, notify, leader }: { data: DashboardResponse; notify: (message: string, error?: boolean) => void; leader?: ReactNode }) {
  const t = useT();
  const { language } = useLanguage();
  const now = useNow();
  const me = data.currentUser;
  const [earned, setEarned] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [plans, setPlans] = useState<SnipePlan[] | null>(null);
  const [ascension, setAscension] = useState<AscensionPillar[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // The job rows wait for the first answers, so a finished week can start folded without a jump.
  const [ready, setReady] = useState(false);
  // A job that couldn't load says so, instead of quietly disappearing from the list.
  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = useCallback(async () => {
    const [dew, snipes, ascensions] = await Promise.all([
      load<DewResponse>("/api/dew"), load<SnipesResponse>("/api/snipes"), load<AscensionsResponse>("/api/ascensions"),
    ]);
    if (dew) { setEarned(dew.resourceRewardEarned); setStreak(dew.streak?.weeks ?? 0); }
    if (snipes) setPlans(snipes.plans);
    if (ascensions) setAscension(ascensions.mine);
    setLoadFailed(!dew || !snipes || !ascensions);
    setReady(true);
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
    ? streak >= 2 ? t("You earned 20 Clan Points. {count} weeks in a row!", { count: streak }) : t("You earned 20 Clan Points.")
    : war.day === 7
      ? t("Earn 20 Clan Points. Please save before Day 1 starts, in {time}.", { time: countdown(war.nextDay, now) })
      : t("Earn 20 Clan Points. The week closes in {time}.", { time: countdown(raceEnd(now), now) });
  const savedEntries = data.entries
    .filter((entry) => currentWeek(new Date(entry.updatedAt)) === week)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const faces = savedEntries
    .map((entry) => data.members.find((member) => member.id === entry.memberId))
    .filter((member): member is Member => !!member)
    .slice(0, 4);
  const update = ownEntry ? t("Update my resources") : t("Add my resources");

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
      announceSnipeAnswered();
      notify(t("Answer saved."));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  // A snipe that's on right now: check in from Home with one tap.
  const live = (plans ?? []).filter((plan) => !plan.archived && checkInOpen(plan.startsAt, now.getTime()))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const checkedIn = !!live?.attendees?.some((attendee) => attendee.memberId === me.id);
  async function checkIn(plan: SnipePlan) {
    setBusy(true);
    try {
      const updated = (await send<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/checkin`, "POST", {})).plan;
      setPlans((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? current);
      announceClanPointsUpdate(me.id);
      notify(t("Checked in! Thanks for joining. +10 Clan Points this week."));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const allDone = earned === true && answered && (!snipe || !!answer);
  // The jobs can only fold once they're all done. Done already when Home opened: start folded.
  // Finished just now: stay open, so the member sees it worked.
  const [doneOnArrival, setDoneOnArrival] = useState<boolean | null>(null);
  if (ready && doneOnArrival === null) setDoneOnArrival(allDone);
  const jobsFold = useFold(`jobs:${week}`, { canFold: allDone, folded: doneOnArrival === true });
  const jobsOpen = ready && jobsFold.open;

  return <div className="home-week">
    {/* Nothing saved yet: what the Hub is for, once. */}
    {!ownEntry && <WelcomeCard />}
    {leader}
    {live && <section className="home-card home-snipe-live" aria-labelledby="home-snipe-live-title">
      <div className="home-card-head"><h2 id="home-snipe-live-title" className="home-kicker"><Target size={19} />{t("Snipe on now")}</h2></div>
      <p className="home-today-main">{displaySnipeTitle(live, t, language)}</p>
      {checkedIn
        ? <p className="snipe-checked-in"><Check size={18} aria-hidden="true" />{t("You’re checked in. Thanks for joining!")}</p>
        : <button type="button" className="home-hero-cta home-checkin" disabled={busy} onClick={() => void checkIn(live)}><Check size={19} aria-hidden="true" /><span>{t("Check in now")}</span><em>{t("+10 points")}</em></button>}
    </section>}
    {/* "Spend or hold?" comes first: the one answer members open the Hub for most days. */}
    <HomeToday now={now} notify={notify} memberId={me.id} />
    <HomeHero update={update} saved={savedEntries.length} total={data.stats.totalMembers} faces={faces} mine={saved} week={week} />
    <section className={`home-card home-jobs-card${jobsOpen ? "" : " folded"}`} aria-labelledby="home-jobs-title">
      <div className="home-card-head">
        <h2 id="home-jobs-title"><ShieldCheck className="home-jobs-icon" size={28} strokeWidth={2.2} aria-hidden="true" />{t("Your jobs this week")}</h2>
        {ready && jobsFold.canFold && <FoldButton open={jobsFold.open} onClick={jobsFold.toggle} label={t("Your jobs this week")} controls="home-jobs-list" />}
      </div>
      {/* Under the heading, so it fits beside the ⌄ on a phone. */}
      {allDone && <p className="home-done"><span className="home-done-tick" aria-hidden="true"><Check size={13} strokeWidth={3.4} /></span>{t("All done!")}</p>}
      {loadFailed && <p className="home-load-failed" role="status">{t("Some of this week’s jobs couldn’t load. Check your connection, then open the Hub again.")}</p>}
      {jobsOpen && <ol className="home-jobs" id="home-jobs-list">
        <li className={`home-job with-side${saved ? " done" : ""}`}>
          <JobMark tone="gold" done={saved}><CoinStack size={24} /></JobMark>
          <div className="home-job-text">
            <strong>{saved ? t("Resources saved") : t("Save your resources")}</strong>
            <small><Gold text={saveHint} value="20" /></small>
          </div>
          {saved
            ? <Link className="home-side-button" href="/resources"><RefreshCw size={15} aria-hidden="true" />{t("Change")}</Link>
            : <Link className="home-side-button round" href="/resources" aria-label={update} title={update}><ArrowRight size={19} aria-hidden="true" /></Link>}
        </li>
        {ascension !== undefined && <li className={`home-job${answered ? " done" : ""}`}>
          <JobMark tone="slate" done={answered}><ChevronsUp size={21} /></JobMark>
          <div className="home-job-text">
            <strong>{ascensionTitle}<TermHelp term="ascending" /></strong>
            {!answered && <small>{t("Tap what you’re ascending, or No.")}</small>}
          </div>
          <div className="home-chips" role="group" aria-label={t("Are you ascending this week?")}>
            <button aria-pressed={answered && ascension.length === 0} onClick={() => void ascend([])}><span>{t("No")}</span></button>
            {ASCENSION_PILLARS.map((pillar) => {
              const Icon = PILLAR_ICONS[pillar];
              return <button key={pillar} aria-pressed={!!ascension?.includes(pillar)} onClick={() => void ascend(togglePillar(pillar))}>
                <Icon size={24} /><span>{t(PILLAR_LABELS[pillar])}</span>
              </button>;
            })}
          </div>
        </li>}
        {snipe && <li className={`home-job${answer ? " done" : ""}`}>
          <JobMark tone="slate" done={!!answer}><Target size={20} /></JobMark>
          <div className="home-job-text">
            <strong>{snipeTitle}<TermHelp term="snipe" /></strong>
            <small>{displaySnipeTitle(snipe, t, language)} · {t("Starts in {time}", { time: countdown(new Date(snipe.startsAt), now) })}</small>
          </div>
          <div className="home-choice" role="group" aria-label={t("Can you join this snipe?")}>
            <button aria-pressed={answer === "yes"} disabled={busy} onClick={() => void respond(snipe, "yes")}><Check size={16} />{t("Yes")}</button>
            <button aria-pressed={answer === "no"} disabled={busy} onClick={() => void respond(snipe, "no")}><X size={16} />{t("No")}</button>
          </div>
        </li>}
      </ol>}
    </section>
  </div>;
}

/** The banner at the top of Home: the clan crest, the one thing to do, and how many have done it. */
function HomeHero({ update, saved, total, faces, mine, week }: { update: string; saved: number; total: number; faces: Member[]; mine: boolean; week: string }) {
  const t = useT();
  const { language } = useLanguage();
  // Shrinks to the progress line once this member has saved this week (they can open it again).
  const fold = useFold(`hero:${week}`, { canFold: mine, folded: mine });
  // The whole clan saved: a rare moment, celebrated once a week on this phone.
  const everyone = total > 0 && saved >= total;
  useEffect(() => { if (everyone) celebrate(t("🎉 The whole clan has saved this week. Stronger together!"), `clan:${week}`); }, [everyone, week, t]);
  // In English the painted lettering from the clan's design; other languages get the brush font,
  // in two lines: the first word in green, the rest in white.
  const title = t("Stronger together");
  const space = title.search(/\s/);
  const first = space < 0 ? title : title.slice(0, space);
  const rest = space < 0 ? "" : title.slice(space + 1);
  return <section className={`home-hero${fold.open ? "" : " folded"}`} aria-label={title}>
    {fold.open && <div className="home-hero-main" id="home-hero-main">
      <img className="home-hero-art" src="/home/banner-art.webp" alt="" width={367} height={370} decoding="async" />
      <div className="home-hero-copy">
        <h2 id="home-hero-title" className="home-hero-title">
          {language === "en"
            ? <img src="/home/stronger-together.webp" alt={title} width={364} height={168} />
            : <span className="home-hero-brush"><span>{first}</span> {rest && <span>{rest}</span>}</span>}
        </h2>
        <p>{t("Update your resources so we can plan, build and dominate together.")}</p>
        <Link className="home-hero-cta" href="/resources"><CoinStack size={22} /><span>{update}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      </div>
      {/* Frays the edges of the brush font, like paint dragged across a wall. */}
      <svg className="home-hero-filters" aria-hidden="true" focusable="false">
        <filter id="home-brush" x="-15%" y="-25%" width="130%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.03 0.9" numOctaves={2} seed={7} result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale={2.4} xChannelSelector="R" yChannelSelector="G" result="torn" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  22 0 0 0 -4.4" result="holes" />
          <feComposite in="torn" in2="holes" operator="in" result="text" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="5 0" result="smear" />
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.9" numOctaves={1} seed={2} result="lines" />
          <feColorMatrix in="lines" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 26 0 0 -15.4" result="streakmask" />
          <feComposite in="smear" in2="streakmask" operator="in" result="rawstreaks" />
          <feComponentTransfer in="rawstreaks" result="streaks"><feFuncA type="linear" slope={3} intercept={-0.5} /></feComponentTransfer>
          <feMerge><feMergeNode in="streaks" /><feMergeNode in="text" /></feMerge>
        </filter>
      </svg>
    </div>}
    <div className="home-hero-progress">
      {faces.length > 0 && <span className="home-hero-faces" aria-hidden="true">{faces.map((member) => <MemberAvatar key={member.id} member={member} small />)}</span>}
      {total > 0 && saved >= total
        ? <p><strong>{t("Everyone has saved!")}</strong><small>{t("The whole clan saved this week.")}</small></p>
        : <p><strong>{t("{count} of {total} members", { count: saved, total })}</strong><small>{t("saved this week")}</small></p>}
      <div className="home-track" role="progressbar" aria-label={t("{count} of {total} members saved this week", { count: saved, total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={saved}>
        <i style={{ width: `${total ? Math.min(100, (saved / total) * 100) : 0}%` }} />
      </div>
      {fold.canFold && <FoldButton open={fold.open} onClick={fold.toggle} label={title} controls="home-hero-main" />}
    </div>
  </section>;
}

type Tone = TodayTone;
const TONE_ICONS: Record<Tone, ComponentType<LucideProps>> = { on: Star, hold: Hand, battle: Swords, claim: Gift };

/** What the clan is doing in the war today: spend, hold, fight or claim; on Days 6–7, vote for next war's days. */
function HomeToday({ now, notify, memberId }: { now: Date; notify: (message: string, error?: boolean) => void; memberId: string }) {
  const t = useT();
  const war = warDay(now);
  const { votes, vote } = useClanDayVotes(war.day >= 6);
  // On Day 7 the war is over, so the clan days shown are the next war's (as on War → This Week).
  const clan = useClanDays(warWeekOf(war.day === 7 ? new Date(now.getTime() + DAY) : now));
  // The same words as the War page's Today card.
  const advice = todayAdvice(war.day, clan, t);
  const badge: { tone: Tone; text: string } | null = advice.tone ? { tone: advice.tone, text: advice.badge } : null;
  const { main, sub } = advice;
  const BadgeIcon = badge ? TONE_ICONS[badge.tone] : null;
  const todayFold = useFold("today");
  return <>
    <section className={`home-card home-today${badge ? ` tone-${badge.tone}` : ""}${todayFold.open ? "" : " folded"}`} aria-labelledby="home-today-title">
      <div className="home-card-head">
        <h2 id="home-today-title" className="home-kicker"><Swords size={19} />{t("Today")} · {t("Day {day} of 7", { day: war.day })}</h2>
        <span className="home-card-tail">
          {badge && BadgeIcon && <span className={`home-badge ${badge.tone}`}><BadgeIcon size={14} aria-hidden="true" />{badge.text}</span>}
          {(badge?.tone === "on" || badge?.tone === "hold") && <TermHelp term={badge.tone === "on" ? "clanDay" : "hold"} />}
          <FoldButton open={todayFold.open} onClick={todayFold.toggle} label={t("Today")} controls="home-today-body" />
        </span>
      </div>
      {todayFold.open && <div id="home-today-body">
      <p className="home-today-main">{main}</p>
      {sub && <p className="home-today-sub">{sub}</p>}
      <p className="home-race">
        <VialIcon size={22} />
        <span><strong>{t("Clan Tech Race")}</strong><TermHelp term="techRace" /> · {t("Knock-out in {time}", { time: countdown(war.nextDay, now) })}<br />{t("In clan missions, pick Clan Tech Vials first.")}</span>
      </p>
      <div className="home-today-foot">
        {war.day < 7
          ? <span className="home-today-time"><Clock size={14} />{t("Day {day} starts in {time}", { day: war.day + 1, time: countdown(war.nextDay, now) })}</span>
          : !votes?.open && <span className="home-today-time"><Clock size={14} />{t("Next war starts in {time}", { time: countdown(war.weekEnd, now) })}</span>}
        <Link className="home-link" href="/war">{t("See the war plan")}<ArrowRight size={15} /></Link>
      </div>
      </div>}
    </section>
    {/* Its own card, so the vote is clearly about the next war and not today's. */}
    {votes?.open && <NextWarVote votes={votes} vote={vote} weekEnd={war.weekEnd} now={now} notify={notify} memberId={memberId} />}
  </>;
}

