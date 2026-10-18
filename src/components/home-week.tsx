"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, Check, ChevronDown, ChevronsUp, Clock, Gift, Hand, RefreshCw, ShieldCheck, Star, Swords, Target, X, type LucideProps } from "lucide-react";
import "@fontsource/knewave/400.css";
import { ASCENSION_PILLARS, ASCENSIONS_UPDATED, PILLAR_LABELS } from "@/lib/ascension";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { countdown, raceEnd, warDay, warWeekOf, WAR_DAYS } from "@/lib/war-calendar";
import { currentWeek, numberFormat, type ResourceKey } from "@/lib/resources";
import { useLanguage, useT } from "@/lib/i18n";
import type { AscensionPillar, AscensionsResponse, DashboardResponse, DewResponse, Member, SnipePlan, SnipesResponse } from "@/lib/types";
import { CrownShield } from "./crown-shield";
import { FoldButton, useFold } from "./home-fold";
import { CoinStack } from "./home-icons";
import { EggIcon, HammerIcon, HorseshoeIcon, PILLAR_ICONS, TicketIcon, VialIcon, type ResourcePicture } from "./resource-icons";
import { MemberAvatar } from "./member-identity";
import { useClanDayVotes, useClanDays, useNow } from "./war-week";
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
 * Home, built for phones: a call to save resources with the clan's progress, the jobs every member has
 * each week (save resources, say whether they're ascending, answer the next snipe), then what to do in
 * the war today. The rest is for the curious.
 */
export function HomeWeek({ data, notify, between }: { data: DashboardResponse; notify: (message: string, error?: boolean) => void; between?: ReactNode }) {
  const t = useT();
  const now = useNow();
  const me = data.currentUser;
  const [earned, setEarned] = useState<boolean | null>(null);
  const [plans, setPlans] = useState<SnipePlan[] | null>(null);
  const [ascension, setAscension] = useState<AscensionPillar[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // The job rows wait for the first answers, so a finished week can start folded without a jump.
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const [dew, snipes, ascensions] = await Promise.all([
      load<DewResponse>("/api/dew"), load<SnipesResponse>("/api/snipes"), load<AscensionsResponse>("/api/ascensions"),
    ]);
    if (dew) setEarned(dew.resourceRewardEarned);
    if (snipes) setPlans(snipes.plans);
    if (ascensions) setAscension(ascensions.mine);
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
    ? t("You earned 20 Clan Points.")
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
      notify(t("Answer saved."));
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
    <HomeHero update={update} saved={savedEntries.length} total={data.stats.totalMembers} faces={faces} mine={saved} week={week} />
    <section className={`home-card home-jobs-card${jobsOpen ? "" : " folded"}`} aria-labelledby="home-jobs-title">
      <div className="home-card-head">
        <h2 id="home-jobs-title"><ShieldCheck className="home-jobs-icon" size={28} strokeWidth={2.2} aria-hidden="true" />{t("Your jobs this week")}</h2>
        {ready && jobsFold.canFold && <FoldButton open={jobsFold.open} onClick={jobsFold.toggle} label={t("Your jobs this week")} controls="home-jobs-list" />}
      </div>
      {/* Under the heading, so it fits beside the ⌄ on a phone. */}
      {allDone && <p className="home-done"><span className="home-done-tick" aria-hidden="true"><Check size={13} strokeWidth={3.4} /></span>{t("All done!")}</p>}
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
            <strong>{ascensionTitle}</strong>
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
            <strong>{snipeTitle}</strong>
            <small>{snipe.title} · {t("Starts in {time}", { time: countdown(new Date(snipe.startsAt), now) })}</small>
          </div>
          <div className="home-choice" role="group" aria-label={t("Can you join this snipe?")}>
            <button aria-pressed={answer === "yes"} disabled={busy} onClick={() => void respond(snipe, "yes")}><Check size={16} />{t("Yes")}</button>
            <button aria-pressed={answer === "no"} disabled={busy} onClick={() => void respond(snipe, "no")}><X size={16} />{t("No")}</button>
          </div>
        </li>}
      </ol>}
    </section>
    {between}
    <HomeToday now={now} notify={notify} memberId={me.id} />
  </div>;
}

/** The banner at the top of Home: the clan crest, the one thing to do, and how many have done it. */
function HomeHero({ update, saved, total, faces, mine, week }: { update: string; saved: number; total: number; faces: Member[]; mine: boolean; week: string }) {
  const t = useT();
  const { language } = useLanguage();
  // Folds down to the progress line once this member has saved this week.
  const fold = useFold(`hero:${week}`, { canFold: mine });
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
      <p><strong>{t("{count} of {total} members", { count: saved, total })}</strong><small>{t("saved this week")}</small></p>
      <div className="home-track" role="progressbar" aria-label={t("{count} of {total} members saved this week", { count: saved, total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={saved}>
        <i style={{ width: `${total ? Math.min(100, (saved / total) * 100) : 0}%` }} />
      </div>
      {fold.canFold && <FoldButton open={fold.open} onClick={fold.toggle} label={title} controls="home-hero-main" />}
    </div>
  </section>;
}

/** Asks the folded clan totals further down Home to open. */
const OPEN_TOTALS = "turmoil-open-totals";

/** The clan's combined war estimate, kept short so it can sit between the jobs and today's plan. */
export function HomeArsenal({ minimum, maximum }: { minimum: number | null; maximum: number | null }) {
  const t = useT();
  const amount = (value: number | null) => value === null ? "--" : numberFormat(Math.round(value));
  const fold = useFold("arsenal");
  return <section className={`home-card home-arsenal${fold.open ? "" : " folded"}`} aria-labelledby="home-arsenal-title">
    <div className="home-card-head">
      <h2 id="home-arsenal-title" className="home-kicker"><CrownShield size={19} />{t("Clan arsenal")}</h2>
      <span className="home-card-tail">
        <span className="live-badge"><i />{t("LIVE TOTALS")}</span>
        <FoldButton open={fold.open} onClick={fold.toggle} label={t("Clan arsenal")} controls="home-arsenal-body" />
      </span>
    </div>
    {fold.open && <div id="home-arsenal-body">
      <p className="home-arsenal-range"><strong>{amount(minimum)}</strong><span aria-hidden="true">–</span><strong>{amount(maximum)}</strong></p>
      <div className="home-today-foot">
        <span className="home-arsenal-label">{t("Total Potential War Points")}</span>
        <button type="button" className="home-link" onClick={() => window.dispatchEvent(new Event(OPEN_TOTALS))}>{t("Clan totals")}<ChevronDown size={16} /></button>
      </div>
    </div>}
  </section>;
}

/** What members spend on the spending days, as the same pictures as the ascending chips. */
type Need = "hammers" | "skills" | "mounts" | "eggs";
const NEEDS: readonly Need[] = ["hammers", "skills", "mounts", "eggs"];
const NEED_ICONS: Record<Need, ResourcePicture> = { hammers: HammerIcon, skills: TicketIcon, mounts: HorseshoeIcon, eggs: EggIcon };
const NEED_RESOURCES: Record<Need, readonly ResourceKey[]> = { hammers: ["hammers"], skills: ["skillTickets"], mounts: ["mountKeys", "mountsToMerge"], eggs: ["eggsPetsTotal", "eggshellsTotal"] };
/** The resources that score on a spending day (from the war calendar). */
function needsOf(day: number): Need[] {
  const resources = WAR_DAYS[day - 1].resources;
  return NEEDS.filter((need) => NEED_RESOURCES[need].some((key) => resources.includes(key)));
}

type Tone = "on" | "hold" | "battle" | "claim";
const TONE_ICONS: Record<Tone, ComponentType<LucideProps>> = { on: Star, hold: Hand, battle: Swords, claim: Gift };

/** What the clan is doing in the war today: spend, hold, fight or claim; on Days 6–7, vote for next war's days. */
function HomeToday({ now, notify, memberId }: { now: Date; notify: (message: string, error?: boolean) => void; memberId: string }) {
  const t = useT();
  const war = warDay(now);
  const { votes, vote } = useClanDayVotes(war.day >= 6);
  const [voting, setVoting] = useState(false);
  async function toggleVote(day: number) {
    const mine = votes?.mine ?? [];
    // Day 6 is always fought, so a vote is the two other days to win.
    if (!mine.includes(day) && mine.length >= 2) {
      notify(t("You can pick 2 days. Tap one of yours to swap it."));
      return;
    }
    setVoting(true);
    const result = await vote(mine.includes(day) ? mine.filter((item) => item !== day) : [...mine, day]);
    setVoting(false);
    if (result.error) notify(t(result.error), true);
    else if (result.rewarded) {
      notify(t("Thanks for voting! +10 Clan Points."));
      announceClanPointsUpdate(memberId);
    }
  }
  // On Day 7 the war is over, so the clan days shown are the next war's (as on War → This Week).
  const clan = useClanDays(warWeekOf(war.day === 7 ? new Date(now.getTime() + DAY) : now));
  let badge: { tone: Tone; text: string } | null = null;
  let main = "";
  let sub = "";
  if (war.day <= 5) {
    if (!clan.loaded) main = "…";
    else if (!clan.days.length) main = t("Leadership hasn’t picked the clan days yet. Check announcements before you spend.");
    else if (clan.days.includes(war.day)) {
      badge = { tone: "on", text: t("Clan day") };
      main = t("Today is a clan day: spend your resources.");
      sub = t(WAR_DAYS[war.day - 1].tip);
    } else {
      badge = { tone: "hold", text: t("Hold") };
      main = t("Today is not a clan day: hold your resources.");
      const next = clan.days.find((day) => day > war.day);
      sub = next ? t("Next clan day: Day {day}.", { day: next }) : t("No more clan days this war.");
    }
  } else if (war.day === 6) {
    badge = { tone: "battle", text: t("Battle") };
    main = t("Fight the other clans. Spending doesn't score today.");
  } else {
    badge = { tone: "claim", text: t("Claim rewards") };
    main = t("Claim your war rewards. You only have today.");
    if (clan.days.length) sub = t("Next war’s clan days: {days}.", { days: clan.days.map((day) => t("Day {day}", { day })).join(", ") });
  }
  const BadgeIcon = badge ? TONE_ICONS[badge.tone] : null;
  const todayFold = useFold("today");
  // The vote can only fold once the member has voted; voted for both days before Home opened:
  // start folded, with the days they picked underneath.
  const mine = votes?.mine ?? [];
  const [votedOnArrival, setVotedOnArrival] = useState<boolean | null>(null);
  if (votes && votedOnArrival === null) setVotedOnArrival(mine.length >= 2);
  const voteFold = useFold(`vote:${votes?.week ?? ""}`, { canFold: mine.length > 0, folded: votedOnArrival === true });
  const needName = (need: Need) => need === "hammers" ? t("Hammers") : need === "skills" ? t("Skills") : need === "mounts" ? t("Mounts") : t("Eggs and pets");
  return <>
    <section className={`home-card home-today${badge ? ` tone-${badge.tone}` : ""}${todayFold.open ? "" : " folded"}`} aria-labelledby="home-today-title">
      <div className="home-card-head">
        <h2 id="home-today-title" className="home-kicker"><Swords size={19} />{t("Today")} · {t("Day {day} of 7", { day: war.day })}</h2>
        <span className="home-card-tail">
          {badge && BadgeIcon && <span className={`home-badge ${badge.tone}`}><BadgeIcon size={14} aria-hidden="true" />{badge.text}</span>}
          <FoldButton open={todayFold.open} onClick={todayFold.toggle} label={t("Today")} controls="home-today-body" />
        </span>
      </div>
      {todayFold.open && <div id="home-today-body">
      <p className="home-today-main">{main}</p>
      {sub && <p className="home-today-sub">{sub}</p>}
      <p className="home-race">
        <VialIcon size={22} />
        <span><strong>{t("Clan Tech Race")}</strong> · {t("Knock-out in {time}", { time: countdown(war.nextDay, now) })}<br />{t("In clan missions, pick Clan Tech Vials first.")}</span>
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
    {votes?.open && <section className={`home-card home-next-war${voteFold.open ? "" : " folded"}`} aria-labelledby="home-next-war-title">
      <div className="home-card-head">
        <h2 id="home-next-war-title" className="home-kicker"><CalendarDays size={19} />{t("Next war starts in {time}", { time: countdown(war.weekEnd, now) })}</h2>
        {/* Before voting: the reward. After voting: the ⌄ to fold it away. */}
        {voteFold.canFold
          ? <FoldButton open={voteFold.open} onClick={voteFold.toggle} label={t("Pick 2 days to win next war (plus Day 6)")} controls="home-next-war-body" />
          : <em className="home-vote-reward">{t("+10 points")}</em>}
      </div>
      {!voteFold.open && <p className="home-fold-summary">{t("Your vote: {days}", { days: mine.map((day) => t("Day {day}", { day })).join(" + ") })}</p>}
      {voteFold.open && <div id="home-next-war-body">
      <p className="home-today-main">{t("Pick 2 days to win next war (plus Day 6)")}</p>
      <div className="home-vote-days" role="group" aria-label={t("Pick 2 days to win next war (plus Day 6)")}>
        {[1, 2, 3, 4, 5].map((day) => <button key={day} aria-pressed={!!votes.mine?.includes(day)} disabled={voting} onClick={() => void toggleVote(day)}>
          <span>{t("Day {day}", { day })}</span>
          <span className="home-vote-needs">
            {needsOf(day).map((need) => { const Icon = NEED_ICONS[need]; return <Icon key={need} size={16} />; })}
            <span className="visually-hidden">{needsOf(day).map(needName).join(", ")}</span>
          </span>
          <strong>{votes.counts[day - 1]}</strong>
        </button>)}
      </div>
      <p className="home-vote-key" aria-hidden="true">{NEEDS.map((need) => { const Icon = NEED_ICONS[need]; return <span key={need}><Icon size={17} />{needName(need)}</span>; })}</p>
      <small className="home-vote-voters">{t("Members voted so far: {count}. Leadership makes the final pick.", { count: votes.voters })}</small>
      </div>}
    </section>}
  </>;
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
