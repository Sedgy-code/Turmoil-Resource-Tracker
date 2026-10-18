"use client";

import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "@/lib/error-text";
import Link from "next/link";
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, ChevronDown, CircleHelp, Download, Eye, LogOut, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { DEW_ITEMS } from "@/lib/dew";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { numberFormat } from "@/lib/resources";
import { useLanguage } from "@/lib/i18n";
import { warDay } from "@/lib/war-calendar";
import type { DashboardResponse, DewResponse, Member } from "@/lib/types";
import { CrownShield } from "./crown-shield";
import { InstallSteps, saveReminders } from "./first-visit";
import { LanguagePicker } from "./language-picker";
import { MemberAvatar, MemberName, MemberTitle } from "./member-identity";
import { MyPlaces } from "./my-places";
import { NextWarVote } from "./next-war-vote";
import { useClanDayVotes, useNow } from "./war-week";
import "./me-page.css";

const DAY = 86_400_000;

/** Saves the member's time away (null: back now). */
async function saveAway(until: string | null): Promise<Member> {
  const response = await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ awayUntil: until }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result.member as Member;
}

/** "Sat 25 Oct": a day on the clan's clock (UTC), in the member's language. */
function dayLabel(date: string, language: string): string {
  return new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * Me: everything about the signed-in member in one place. Their numbers and places, Clan Points,
 * their vote, time away, reminders, language, help and sign-out. Leaders also get their tools here.
 */
export function MePage({ data, notify, refresh, onSignOut, onOpenGuide }: {
  data: DashboardResponse;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
  onSignOut: () => void;
  onOpenGuide: () => void;
}) {
  const { t, language } = useLanguage();
  const now = useNow();
  const [me, setMe] = useState<Member>(data.currentUser);
  useEffect(() => setMe(data.currentUser), [data.currentUser]);
  const entry = data.entries.find((item) => item.memberId === me.id);
  const [wallet, setWallet] = useState<DewResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dew", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<DewResponse> : Promise.reject())
      .then((result) => { if (!cancelled) { setWallet(result); announceClanPointsUpdate(me.id, result.balance); } })
      .catch(() => { /* the card says it couldn't load */ });
    return () => { cancelled = true; };
  }, [me.id]);
  const spent = wallet ? DEW_ITEMS.filter((item) => wallet.owned.includes(item.id)).reduce((total, item) => total + item.cost, 0) : 0;
  const war = warDay(now);
  const { votes, vote } = useClanDayVotes(war.day >= 6);

  // Time away
  const today = now.toISOString().slice(0, 10);
  const latest = new Date(now.getTime() + 90 * DAY).toISOString().slice(0, 10);
  const [awayDate, setAwayDate] = useState("");
  const [busy, setBusy] = useState<"away" | "reminders" | null>(null);
  async function changeAway(until: string | null) {
    setBusy("away");
    try {
      const updated = await saveAway(until);
      setMe(updated);
      setAwayDate("");
      notify(until ? t("Leaders can see you’re away until {date}.", { date: dayLabel(until, language) }) : t("Welcome back! Reminders are back on."));
      void refresh();
    } catch (error) {
      notify(t(errorText(error)), true);
    } finally {
      setBusy(null);
    }
  }
  async function toggleReminders() {
    setBusy("reminders");
    try {
      const updated = await saveReminders(!me.remindersAllowed);
      setMe(updated);
      notify(updated.remindersAllowed ? t("Discord reminders are on.") : t("Discord reminders are off."));
    } catch (error) {
      notify(t(errorText(error)), true);
    } finally {
      setBusy(null);
    }
  }
  const [installOpen, setInstallOpen] = useState(false);

  return <div className="me-page">
    <section className="home-card me-profile" aria-label={me.username}>
      <MemberAvatar member={me} />
      <div>
        <strong className="me-name"><MemberName member={me} /></strong>
        <MemberTitle member={me} />
        <span className="me-role">{me.role === "ADMIN" ? t("Clan admin") : t("Clan member")}{" · "}{t("In the clan since {date}", { date: new Intl.DateTimeFormat(language, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(me.joinedAt)) })}</span>
      </div>
    </section>

    {/* Your numbers, each with your place in the clan. */}
    <MyPlaces data={data} title={t("My numbers")}
      action={<Link className="home-side-button" href="/resources">{entry ? t("Update") : t("Add")}<ArrowRight size={15} aria-hidden="true" /></Link>}
      footer={entry && <p className="me-saved">{t("Saved {date}", { date: `${new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(entry.updatedAt))} UTC` })}</p>} />

    <section className="home-card me-points" aria-labelledby="me-points-title">
      <div className="home-card-head">
        <h2 id="me-points-title"><CrownShield size={22} />{t("Clan Points")}</h2>
        <strong className="me-balance">{wallet ? numberFormat(wallet.balance) : "—"}</strong>
      </div>
      {wallet ? <>
        <p className="me-points-week">{t("This week")}</p>
        <ul className="me-earn">
          <li className={wallet.resourceRewardEarned ? "done" : ""}><span aria-hidden="true">{wallet.resourceRewardEarned ? <Check size={14} strokeWidth={3} /> : null}</span>{t("Save your resources")}<b>+20</b></li>
          <li className={wallet.voteRewardEarned ? "done" : ""}><span aria-hidden="true">{wallet.voteRewardEarned ? <Check size={14} strokeWidth={3} /> : null}</span>{t("Vote for clan days")}<b>+10</b></li>
          <li className={wallet.snipeRewardEarned ? "done" : ""}><span aria-hidden="true">{wallet.snipeRewardEarned ? <Check size={14} strokeWidth={3} /> : null}</span>{t("Join a snipe")}<b>+10</b></li>
        </ul>
        {spent > 0 && <p className="me-spent">{t("Spent in the shop: {count}", { count: numberFormat(spent) })}</p>}
      </> : <p className="me-empty">{t("Couldn’t load your Clan Points. Check your connection, then open this page again.")}</p>}
      <Link className="button primary me-wide" href="/reward-shop"><Sparkles size={17} />{t("Open the Reward Shop")}</Link>
    </section>

    {votes?.open && <NextWarVote votes={votes} vote={vote} weekEnd={war.weekEnd} now={now} notify={notify} memberId={me.id} />}

    <section className="home-card me-away" aria-labelledby="me-away-title">
      <div className="home-card-head"><h2 id="me-away-title"><CalendarDays size={21} />{t("Time away")}</h2></div>
      {me.holidayUntil ? <>
        <p className="me-away-now">{t("You’re away until {date}.", { date: dayLabel(me.holidayUntil, language) })}</p>
        <p className="me-hint">{t("Leaders can see this, and you won’t get reminders until you’re back.")}</p>
        <button type="button" className="button primary me-wide" disabled={busy !== null} onClick={() => void changeAway(null)}><Check size={17} />{t("I’m back")}</button>
      </> : <form className="me-away-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (awayDate) void changeAway(awayDate); }}>
        <p className="me-hint">{t("Going on holiday or taking a break? Tell leaders when you’ll be back, and reminders stop until then.")}</p>
        <label>
          <span>{t("I’m away until")}</span>
          <input type="date" min={today} max={latest} value={awayDate} onChange={(event) => setAwayDate(event.target.value)} required />
        </label>
        <button type="submit" className="button secondary me-wide" disabled={busy !== null || !awayDate}>{t("Save")}</button>
      </form>}
    </section>

    <section className="home-card me-reminders" aria-labelledby="me-reminders-title">
      <div className="home-card-head"><h2 id="me-reminders-title"><Bell size={21} />{t("Discord reminders")}</h2></div>
      <p className="me-hint">{t("If you haven’t saved, a leader can send you one Discord message a week. Never more.")}</p>
      <button type="button" className={`me-switch${me.remindersAllowed ? " on" : ""}`} role="switch" aria-checked={me.remindersAllowed === true} disabled={busy !== null} onClick={() => void toggleReminders()}>
        <span className="me-switch-track" aria-hidden="true"><i /></span>
        {me.remindersAllowed ? t("Reminders are on") : t("Reminders are off")}
      </button>
    </section>

    <section className="home-card me-settings" aria-labelledby="me-settings-title">
      <div className="home-card-head"><h2 id="me-settings-title">{t("Settings and help")}</h2></div>
      <div className="me-row me-language"><span>{t("Language")}</span><LanguagePicker /></div>
      <Link className="me-row" href="/guide"><BookOpen size={19} aria-hidden="true" /><span>{t("Picture guide")}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      <button type="button" className="me-row" onClick={onOpenGuide}><CircleHelp size={19} aria-hidden="true" /><span>{t("How the Hub works")}</span><ArrowRight size={16} aria-hidden="true" /></button>
      <button type="button" className="me-row" aria-expanded={installOpen} aria-controls="me-install" onClick={() => setInstallOpen(!installOpen)}><Download size={19} aria-hidden="true" /><span>{t("Add the Hub to your home screen")}</span><ChevronDown size={16} className={installOpen ? "me-open" : ""} aria-hidden="true" /></button>
      {installOpen && <div id="me-install" className="me-install"><InstallSteps /></div>}
    </section>

    {me.role === "ADMIN" && <section className="home-card me-leader" aria-labelledby="me-leader-title">
      <div className="home-card-head"><h2 id="me-leader-title"><ShieldCheck size={21} />{t("Leader tools")}</h2></div>
      <Link className="me-row" href="/status"><Users size={19} aria-hidden="true" /><span>{t("Status board")}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      <Link className="me-row" href="/members"><ShieldCheck size={19} aria-hidden="true" /><span>{t("Members")}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      <Link className="me-row" href="/contribution-ranking"><Trophy size={19} aria-hidden="true" /><span>{t("Ranking")}</span><ArrowRight size={16} aria-hidden="true" /></Link>
      <Link className="me-row" href="/hoarding-watch"><Eye size={19} aria-hidden="true" /><span>{t("Hoarding")}</span><ArrowRight size={16} aria-hidden="true" /></Link>
    </section>}

    <button type="button" className="button secondary me-sign-out" onClick={onSignOut}><LogOut size={17} />{t("Sign out")}</button>
  </div>;
}
