"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Camera, ChevronRight, ClipboardList, FlaskConical, ShieldCheck, Target, Trophy, Users } from "lucide-react";
import { countdown, utcDateTime } from "@/lib/war-calendar";
import { useLanguage } from "@/lib/i18n";
import type { LeaderTodo } from "@/lib/types";
import { useNow } from "./war-week";
import "./me-page.css";

/** One job on the card: the whole row opens the screen where it's done. */
function Job({ href, icon, title, detail }: { href: string; icon: ReactNode; title: string; detail?: string }) {
  return <li><Link className="leader-job" href={href}>
    <span className="leader-job-icon" aria-hidden="true">{icon}</span>
    <span className="leader-job-text"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    <ChevronRight size={18} className="leader-job-go" aria-hidden="true" />
  </Link></li>;
}

/**
 * Leaders' to-do card at the top of Home: only what's due now, each line opening the exact screen,
 * with the leader tools underneath even when nothing is due.
 */
export function LeaderTodoCard() {
  const { t, language } = useLanguage();
  const now = useNow();
  const [todo, setTodo] = useState<LeaderTodo | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/leader", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setTodo(await response.json() as LeaderTodo);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);
  const jobs: ReactNode[] = [];
  if (todo?.warDay) jobs.push(<Job key="warday" href="/war-results" icon={<Camera size={19} />} title={t("Add the Day {day} war screenshot", { day: todo.warDay.day })} detail={t("Day {day} ends in {time}", { day: todo.warDay.day, time: countdown(new Date(todo.warDay.endsAt), now) })} />);
  if (todo?.clanDays) jobs.push(<Job key="days" href="/war" icon={<CalendarDays size={19} />}
    title={todo.clanDays.nextWar ? t("Pick next war’s clan days") : t("Pick this war’s clan days")}
    detail={todo.clanDays.nextWar ? t("Members voted so far: {count}.", { count: todo.clanDays.voters }) : t("Members don’t know when to spend yet.")} />);
  if (todo?.warResults) jobs.push(<Job key="war" href="/war-results" icon={<Trophy size={19} />} title={t("Add the end-of-war screenshots")} detail={t("Before the next war starts, in {time}", { time: countdown(new Date(todo.warResults.closesAt), now) })} />);
  if (todo?.vials) jobs.push(<Job key="vials" href="/vial-donations" icon={<FlaskConical size={19} />} title={t("Add the vial donation screenshots")} detail={t("The race resets in {time}", { time: countdown(new Date(todo.vials.closesAt), now) })} />);
  for (const snipe of todo?.attendance ?? []) {
    jobs.push(<Job key={snipe.id} href="/snipes" icon={<Target size={19} />} title={t("Check who came to {title}", { title: snipe.title })}
      detail={`${utcDateTime(snipe.startsAt, language)} · ${t("{count} checked in, {yes} said Yes", { count: snipe.checkedIn, yes: snipe.saidYes })}`} />);
  }
  if (todo && todo.unsaved > 0) jobs.push(<Job key="unsaved" href="/status" icon={<ClipboardList size={19} />} title={t("{count} members haven’t saved this week", { count: todo.unsaved })} detail={t("See who, and send a reminder")} />);
  return <section className="home-card leader-todo" aria-labelledby="leader-todo-title">
    <div className="home-card-head">
      <h2 id="leader-todo-title" className="home-kicker"><ShieldCheck size={19} />{t("Leader to-do")}</h2>
      {todo && todo.away > 0 && <span className="leader-away">{t("{count} away", { count: todo.away })}</span>}
    </div>
    {failed && !todo && <p className="leader-empty">{t("Couldn’t load the leader jobs. Check your connection, then open this page again.")}</p>}
    {todo && (jobs.length ? <ul className="leader-jobs">{jobs}</ul> : <p className="leader-empty">{t("Nothing due right now.")}</p>)}
    <nav className="leader-tools" aria-label={t("Leader tools")}>
      <Link href="/status"><Users size={16} aria-hidden="true" />{t("Status board")}</Link>
      <Link href="/members"><ShieldCheck size={16} aria-hidden="true" />{t("Members")}</Link>
      <Link href="/contribution-ranking"><Trophy size={16} aria-hidden="true" />{t("Ranking")}</Link>
      <Link href="/hoarding-watch"><ClipboardList size={16} aria-hidden="true" />{t("Hoarding")}</Link>
    </nav>
  </section>;
}
