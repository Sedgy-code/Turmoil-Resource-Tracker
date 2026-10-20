"use client";

import { useCallback, useEffect, useState } from "react";
import { errorText } from "@/lib/error-text";
import { Bell, Check, LoaderCircle, Megaphone, Search } from "lucide-react";
import { countdown, utcDateTime } from "@/lib/war-calendar";
import { displaySnipeTitle } from "@/lib/snipe-day";
import { useLanguage } from "@/lib/i18n";
import type { Member, MemberWeekState, StatusResponse, StatusRow } from "@/lib/types";
import { MemberHistoryPanel } from "./member-history";
import { MemberAvatar, MemberName } from "./member-identity";
import "./me-page.css";

type Filter = "all" | MemberWeekState;

/**
 * Leadership's status board: every member's clan week at a glance, the ones still to save first.
 * Leaders can remind one member (a private Discord message if they allowed it, otherwise a mention in
 * the reminder channel, once a week each) or everyone not saved at once (one post, every 12 hours).
 */
const REMIND_ALL_EVERY_MS = 12 * 3_600_000;

export function StatusBoard({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { t, language } = useLanguage();
  const [board, setBoard] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Member | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setBoard(result as StatusResponse);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function remindAll(count: number) {
    if (!window.confirm(t("Post a reminder in Discord mentioning {count} members who haven’t saved?", { count }))) return;
    setBusy("all");
    try {
      const response = await fetch("/api/status/remind-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Please try again.");
      notify(t("Reminder posted in Discord for {count} members.", { count: result.reminder.count }));
    } catch (e) {
      notify(t(errorText(e)), true);
    } finally {
      setBusy(null);
      void load();
    }
  }
  async function nudge(row: StatusRow) {
    setBusy(row.member.id);
    try {
      const response = await fetch("/api/status/nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: row.member.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setBoard((current) => current && { ...current, rows: current.rows.map((item) => item.member.id === row.member.id ? { ...item, nudge: result.nudge } : item) });
      notify(t("Reminder sent to {name}.", { name: row.member.username }));
    } catch (e) {
      notify(t(errorText(e)), true);
      void load();
    } finally {
      setBusy(null);
    }
  }
  const counts = { all: board?.rows.length ?? 0, notStarted: 0, away: 0, saved: 0 } as Record<Filter, number>;
  for (const row of board?.rows ?? []) counts[row.state]++;
  const rows = (board?.rows ?? [])
    .filter((row) => filter === "all" || row.state === filter)
    .filter((row) => row.member.username.toLowerCase().includes(search.trim().toLowerCase()));
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("Everyone") },
    { key: "notStarted", label: t("Not saved") },
    { key: "away", label: t("Away") },
    { key: "saved", label: t("Saved") },
  ];
  const time = (iso: string) => new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) + " UTC";
  const day = (date: string) => new Intl.DateTimeFormat(language, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
  const ago = (iso: string | null) => {
    if (!iso) return t("Never saved");
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days < 1 ? t("Last saved today") : t("Last saved {count}d ago", { count: days });
  };
  return <div className="status-board">
    {error && <div className="error-banner" role="alert"><span>{t(error)}</span><button onClick={() => void load()}>{t("Retry")}</button></div>}
    {!board && !error && <p className="status-loading"><LoaderCircle className="spin" size={18} />{t("Loading…")}</p>}
    {board && <>
      <p className="status-intro">{t("This clan week, Monday to Monday (UTC). Members still to save are first.")}
        {board.snipe && <> {t("Next snipe: {title}, {date}.", { title: displaySnipeTitle(board.snipe, t, language), date: utcDateTime(board.snipe.startsAt, language) })}</>}
      </p>
      {/* Everyone not saved (members away are left out), with one Discord post. */}
      {counts.notStarted > 0 && (() => {
        const nextAt = board.lastReminder ? new Date(board.lastReminder.at).getTime() + REMIND_ALL_EVERY_MS : 0;
        const waiting = nextAt > Date.now();
        return <div className="status-remind-all">
          <button type="button" className="button primary" disabled={busy !== null || waiting} onClick={() => void remindAll(counts.notStarted)}>
            {busy === "all" ? <LoaderCircle size={16} className="spin" /> : <Megaphone size={16} />}
            {waiting ? t("Remind everyone again in {time}", { time: countdown(new Date(nextAt)) }) : t("Remind everyone not saved ({count})", { count: counts.notStarted })}
          </button>
          {board.lastReminder && <small className="status-nudged"><Bell size={13} aria-hidden="true" />{t("Reminded by {name}, {time}", { name: board.lastReminder.by, time: time(board.lastReminder.at) })}</small>}
        </div>;
      })()}
      <div className="status-filters" role="group" aria-label={t("Show")}>
        {filters.map(({ key, label }) => <button key={key} type="button" aria-pressed={filter === key} className={`tone-${key}`} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>)}
      </div>
      <label className="search-input status-search"><Search size={16} /><input placeholder={t("Search members…")} aria-label={t("Search members…")} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <ul className="status-rows">
        {rows.map((row) => <li key={row.member.id} className={`status-row state-${row.state}`}>
          <button type="button" className="status-member" onClick={() => setHistoryFor(row.member)} aria-label={t("Open {name}’s history", { name: row.member.username })}>
            <MemberAvatar member={row.member} small />
            <span className="status-member-text">
              <strong><MemberName member={row.member} /></strong>
              <small>
                {row.state === "saved" ? <span className="status-chip saved"><Check size={12} strokeWidth={3} aria-hidden="true" />{t("Saved")}</span>
                  : row.state === "away" ? <span className="status-chip away">{t("Away until {date}", { date: row.member.holidayUntil ? day(row.member.holidayUntil) : "" })}</span>
                    : <span className="status-chip todo">{t("Not saved")}</span>}
                <span>{row.state === "saved" && row.savedAt ? time(row.savedAt) : ago(row.savedAt)}</span>
              </small>
              {(board.voting || board.snipe) && <small className="status-extra">
                {board.voting && <span>{row.vote ? t("Vote: {days}", { days: row.vote.map((day) => t("Day {day}", { day })).join(" + ") }) : t("No vote yet")}</span>}
                {board.snipe && <span>{row.snipe === "yes" ? t("Snipe: Yes") : row.snipe === "no" ? t("Snipe: No") : t("Snipe: no answer")}</span>}
              </small>}
            </span>
          </button>
          <div className="status-action">
            {row.nudge ? <small className="status-nudged"><Bell size={13} aria-hidden="true" />{t("Reminded by {name}, {time}", { name: row.nudge.by, time: time(row.nudge.at) })}</small>
              : row.state === "notStarted" ? <button type="button" className="button secondary small-button" disabled={busy !== null} onClick={() => void nudge(row)}>
                {busy === row.member.id ? <LoaderCircle size={14} className="spin" /> : <Bell size={14} />}{t("Remind")}
              </button> : null}
          </div>
        </li>)}
      </ul>
      {!rows.length && <p className="status-loading">{t("No members match this view.")}</p>}
    </>}
    {historyFor && <MemberHistoryPanel member={historyFor} notify={notify} onClose={() => setHistoryFor(null)} onChanged={() => void load()} />}
  </div>;
}
