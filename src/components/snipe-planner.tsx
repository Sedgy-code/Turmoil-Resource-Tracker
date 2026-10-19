"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { errorText } from "@/lib/error-text";
import { Archive, CalendarDays, CalendarPlus, Check, Crosshair, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { checkInOpen, downloadCalendarFile, googleCalendarLink, snipeCalendarFile } from "@/lib/snipe-calendar";
import { beforeResetTime, displaySnipeTitle, minutesBeforeReset, nextSnipeStart, RESET_LEAD_MINUTES, SNIPE_DAYS, snipeDay, snipeDayActivities, snipeTitle } from "@/lib/snipe-day";
import { numberFormat } from "@/lib/resources";
import { WAR_ACTIVITIES } from "@/lib/war";
import { ACTIVITY_ICONS } from "./resource-icons";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { useLanguage } from "@/lib/i18n";
import { countdown, utcDateTime } from "@/lib/war-calendar";
import type { DashboardResponse, SnipePlan, SnipesResponse, WarActivity } from "@/lib/types";
import { useSortable } from "./sortable";
import { useStackFold } from "./stack-fold";
import "./attendance.css";

type Props = {
  data: DashboardResponse;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result as T;
}

function points(minimum: number, maximum: number) {
  return minimum === maximum ? numberFormat(minimum) : `${numberFormat(minimum)}–${numberFormat(maximum)}`;
}

/** Matches the server: attendance confirmed within 8 days of the start still earns Clan Points. */
const REWARD_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

type PlanDraft = { title: string; startsAt: string; activities: WarActivity[] };

function PlanForm({ plan, busy, onCancel, onSave }: { plan?: SnipePlan; busy: boolean; onCancel: () => void; onSave: (draft: PlanDraft) => Promise<void> }) {
  const { t, language } = useLanguage();
  // Leaders pick the war day; the Hub knows which week it is. The title writes itself.
  const [day, setDay] = useState<number | null>(() => (plan ? snipeDay(plan.startsAt) : null));
  // Snipes start just before the day's reset (00:00 UTC): 30 to 5 minutes before.
  const [lead, setLead] = useState<number | null>(() => (plan ? minutesBeforeReset(plan.startsAt) : 30));
  const [activities, setActivities] = useState<WarActivity[]>(() => (plan && snipeDay(plan.startsAt) ? plan.activities : []));
  const [error, setError] = useState("");
  const choose = (next: number) => {
    setDay(next);
    setActivities(snipeDayActivities(next));
    setError("");
  };
  const startsAt = day && lead ? nextSnipeStart(day, beforeResetTime(lead)) : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!day || !lead || !startsAt || !activities.length) {
      setError(t("Pick a war day, how long before reset, and at least one scoring activity."));
      return;
    }
    setError("");
    await onSave({ title: snipeTitle(day, activities), startsAt: startsAt.toISOString(), activities });
  }
  return <form className="planning-form planning-plan-form" onSubmit={submit}>
    <h3>{plan ? t("Edit snipe plan") : t("Create a snipe plan")}</h3>
    <fieldset className="planning-field snipe-day-field">
      <legend>{t("Which war day?")}</legend>
      <div className="planning-tabs snipe-day-picker">{SNIPE_DAYS.map((option) => <button type="button" key={option} aria-pressed={day === option} onClick={() => choose(option)}>{t("Day {day}", { day: option })}</button>)}</div>
    </fieldset>
    <fieldset className="planning-field snipe-day-field">
      <legend>{t("How long before reset?")}</legend>
      <div className="planning-tabs snipe-lead-picker">{RESET_LEAD_MINUTES.map((option) => <button type="button" key={option} aria-pressed={lead === option} onClick={() => { setLead(option); setError(""); }}>{t("{minutes} min", { minutes: option })}</button>)}</div>
      {startsAt && <small className="snipe-day-date"><CalendarDays size={14} aria-hidden="true" />{utcDateTime(startsAt.toISOString(), language)}</small>}
    </fieldset>
    {day && <fieldset className="planning-activities"><legend>{t("Scoring activities")}</legend>{WAR_ACTIVITIES.filter(({ key }) => snipeDayActivities(day).includes(key)).map(({ key, label }) => { const Picture = ACTIVITY_ICONS[key]; return <label className="planning-check planning-check-compact" key={key}><input type="checkbox" checked={activities.includes(key)} onChange={() => setActivities((selected) => selected.includes(key) ? selected.filter((activity) => activity !== key) : [...selected, key])} /><Picture size={22} className="planning-check-icon" /><span>{t(label)}</span></label>; })}</fieldset>}
    {day && <p className="snipe-title-preview"><span>{t("Snipe title")}</span><strong>{snipeTitle(day, activities, t, language)}</strong></p>}
    {error && <p className="planning-notice" role="alert">{error}</p>}
    <div className="planning-form-actions"><button type="button" className="planning-button planning-button-subtle" disabled={busy} onClick={onCancel}>{t("Cancel")}</button><button type="submit" className="planning-button" disabled={busy}>{busy && <LoaderCircle size={15} className="spin" />}{plan ? t("Save plan") : t("Create snipe")}</button></div>
  </form>;
}

function ParticipantsTable({ plan, activityLabels, meId }: { plan: SnipePlan; activityLabels: (typeof WAR_ACTIVITIES)[number][]; meId: string }) {
  const { t, language } = useLanguage();
  const getters: Record<string, (row: SnipePlan["participants"][number]) => string | number> = {
    member: ({ member }) => member.username,
    total: ({ estimate }) => estimate.minimum,
  };
  for (const activity of activityLabels) getters[activity.key] = ({ estimate }) => estimate.rows.find((row) => row.activity === activity.key)?.minimum ?? 0;
  const { sorted, header } = useSortable(plan.participants, getters, { key: "total", direction: "desc" });
  // Your own row first, and open; on a phone the others are one line (total points) until tapped.
  const rows = [...sorted.filter(({ member }) => member.id === meId), ...sorted.filter(({ member }) => member.id !== meId)];
  const fold = useStackFold(meId);
  return <div className="planning-table-wrap"><table className="planning-table planning-participants stack-table"><caption className="planning-sr-only">{t("{title}: who’s joining and their war point estimates", { title: displaySnipeTitle(plan, t, language) })}</caption><thead><tr>{header("member", t("Member"))}{activityLabels.map((activity) => { const Picture = ACTIVITY_ICONS[activity.key]; return header(activity.key, t(activity.label), { icon: <Picture size={18} /> }); })}{header("total", t("Total points"))}</tr></thead><tbody>{rows.map(({ member, estimate }) => <tr key={member.id} {...fold.row(member.id, member.id === meId ? "row-me" : undefined)}><th scope="row" className="stack-title">{member.username}{member.id === meId && <span className="you-badge">{t("you")}</span>}</th>{activityLabels.map((activity) => { const row = estimate.rows.find((row) => row.activity === activity.key); return <td key={activity.key} data-label={t(activity.label)}>{row ? points(row.minimum, row.maximum) : "0"}</td>; })}<td className="planning-gold stack-wide stack-key" data-label={t("Total points")}>{points(estimate.minimum, estimate.maximum)}</td>{fold.toggleCell(member.id)}</tr>)}{plan.participants.length === 0 && <tr><td colSpan={activityLabels.length + 2} className="planning-table-empty">{t("Members who answer Yes will appear here.")}</td></tr>}</tbody></table></div>;
}

export function SnipePlanner({ data, notify }: Props) {
  const { t, language } = useLanguage();
  const [plans, setPlans] = useState<SnipePlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"open" | "history">("open");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestGeneration = useRef(0);
  const loadingGeneration = useRef<number | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const busyRef = useRef<string | null>(null);
  const isAdmin = data.currentUser.role === "ADMIN";
  const load = useCallback(async () => {
    if (loadingGeneration.current !== null || busyRef.current !== null) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    loadingGeneration.current = generation;
    loadController.current = controller;
    setRefreshing(true);
    setLoadError("");
    try {
      const result = await request<SnipesResponse>("/api/snipes", { signal: controller.signal });
      if (generation === requestGeneration.current) {
        setPlans(result.plans);
        setLoaded(true);
      }
    } catch (error) {
      if (generation === requestGeneration.current && !controller.signal.aborted) {
        setLoadError(error instanceof Error ? error.message : "Please try again.");
      }
    } finally {
      if (loadingGeneration.current === generation) {
        loadingGeneration.current = null;
        loadController.current = null;
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    void load();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = setInterval(refreshVisible, 30_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      requestGeneration.current++;
      loadController.current?.abort();
      loadController.current = null;
      loadingGeneration.current = null;
    };
  }, [load, data.currentUser.id]);

  function beginMutation(id: string) {
    if (busyRef.current !== null) return false;
    busyRef.current = id;
    requestGeneration.current++;
    loadController.current?.abort();
    loadController.current = null;
    loadingGeneration.current = null;
    setRefreshing(false);
    setBusy(id);
    return true;
  }
  function finishMutation() {
    busyRef.current = null;
    setBusy(null);
  }

  function replacePlan(plan: SnipePlan) { setPlans((current) => [plan, ...current.filter((item) => item.id !== plan.id)]); }
  async function savePlan(draft: PlanDraft, id?: string) {
    if (!beginMutation(id || "create")) return;
    try {
      const result = await request<{ plan: SnipePlan }>(id ? `/api/snipes/${id}` : "/api/snipes", { method: id ? "PATCH" : "POST", body: JSON.stringify(draft) });
      replacePlan(result.plan);
      setCreating(false); setEditing(null); setTab("open");
      notify(id ? t("Snipe plan updated.") : t("Snipe plan created."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  async function respond(plan: SnipePlan, answer: "yes" | "no") {
    if (!beginMutation(plan.id)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/response`, { method: "POST", body: JSON.stringify({ answer }) });
      replacePlan(result.plan);
      notify(t(answer === "yes" ? "You’re on the list for this snipe." : "Your response was saved."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  async function archive(plan: SnipePlan) {
    if (!beginMutation(plan.id)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
      replacePlan(result.plan); setEditing(null); notify(t("Snipe archived with its attendance and point estimates."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  async function setAttendance(plan: SnipePlan, memberIds: string[], attended: boolean) {
    if (!memberIds.length || !beginMutation(`attendance:${plan.id}:${memberIds.length === 1 ? memberIds[0] : "all"}`)) return;
    try {
      let latest = plan;
      for (const memberId of memberIds) {
        const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/attendance`, {
          method: "POST",
          body: JSON.stringify({ memberId, attended }),
        });
        latest = result.plan;
        announceClanPointsUpdate(memberId);
      }
      replacePlan(latest);
      const rewarded = Date.now() - new Date(plan.startsAt).getTime() <= REWARD_WINDOW_MS;
      notify(!attended ? t("Attendance removed. Any Clan Points from it were taken back.")
        : rewarded ? (memberIds.length > 1 ? t("{count} members ticked. Each gets 10 Clan Points (once per week).", { count: memberIds.length }) : t("Ticked. They get 10 Clan Points (once per week)."))
          : t("Attendance saved. This snipe is too old to give Clan Points."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  async function checkIn(plan: SnipePlan) {
    if (!beginMutation(`checkin:${plan.id}`)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/checkin`, { method: "POST", body: "{}" });
      replacePlan(result.plan);
      announceClanPointsUpdate(data.currentUser.id);
      notify(t("Checked in! Thanks for joining. +10 Clan Points this week."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  /** The snipe in the member's own calendar, with a reminder when check-in opens. */
  const calendarText = (plan: SnipePlan) => ({
    summary: t("Turmoil snipe: {title}", { title: displaySnipeTitle(plan, t, language) }),
    description: t("Check in on the Clan Hub when it starts: {link}", { link: `${window.location.origin}/snipes` }),
  });
  async function reopen(plan: SnipePlan) {
    if (!beginMutation(plan.id)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
      replacePlan(result.plan); setTab("open"); notify(t("Snipe reopened."));
    } catch (error) { notify(t(errorText(error)), true); }
    finally { finishMutation(); }
  }
  const visible = plans.filter((plan) => plan.archived === (tab === "history")).sort((a, b) => tab === "history" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt));
  return <div className="planning-stack">
    <section className="planning-panel">
      <div className="planning-heading"><div><h2>{t("Snipe Plans")}</h2><p>{t("Tell the clan if you can join each snipe.")}</p></div><div className="planning-inline-actions"><button className="planning-button planning-button-subtle" aria-label={t("Refresh")} onClick={() => void load()} disabled={refreshing || busy !== null}><RefreshCw size={15} className={refreshing ? "spin" : undefined} />{t("Refresh")}</button>{isAdmin && <button className="planning-button" onClick={() => { setCreating((open) => !open); setEditing(null); }} disabled={!loaded || busy !== null} aria-expanded={creating}><Plus size={16} />{t("New snipe")}</button>}</div></div>
      <div className="planning-controls"><div className="planning-tabs" aria-label={t("Snipe Plans")}><button aria-pressed={tab === "open"} onClick={() => setTab("open")}>{t("Active")} <span aria-hidden="true">{plans.filter((plan) => !plan.archived).length}</span></button><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>{t("History")} <span aria-hidden="true">{plans.filter((plan) => plan.archived).length}</span></button></div></div>
      {loaded && loadError && <p className="planning-notice" role="status">{t("The latest plans could not be loaded. Press Refresh to try again.")}</p>}
      {creating && isAdmin && <PlanForm busy={busy !== null} onCancel={() => setCreating(false)} onSave={(draft) => savePlan(draft)} />}
    </section>
    {!loaded ? <section className="planning-panel planning-state" aria-live="polite">{loadError ? <><h2>{t("Snipe plans are unavailable")}</h2><p>{t(loadError)}</p><button className="planning-button" onClick={() => void load()}>{t("Try again")}</button></> : <><LoaderCircle size={24} className="spin" /><p>{t("Loading…")}</p></>}</section> : visible.length === 0 ? <section className="planning-panel planning-state"><Crosshair size={32} className="planning-gold" /><h2>{t(tab === "history" ? "No archived snipes yet" : "No open snipe plans")}</h2><p>{tab === "history" ? t("Finished snipes will show here.") : isAdmin ? t("Create a plan to collect attendance and prepare the clan.") : t("Clan leadership will add the next snipe here.")}</p></section> : visible.map((plan) => {
      const answer = plan.responses.find((response) => response.memberId === data.currentUser.id)?.answer;
      const activityLabels = plan.activities.map((activity) => WAR_ACTIVITIES.find(({ key }) => key === activity)).filter((activity) => activity !== undefined);
      const unavailable = data.members.filter((member) => member.active && plan.responses.some((response) => response.memberId === member.id && response.answer === "no"));
      const unanswered = data.members.filter((member) => member.active && !plan.responses.some((response) => response.memberId === member.id));
      const started = new Date(plan.startsAt).getTime() <= Date.now();
      const attendees = plan.attendees || [];
      const attendedIds = new Set(attendees.map(({ memberId }) => memberId));
      const activeMembers = data.members.filter((member) => member.active).sort((a, b) => a.username.localeCompare(b.username));
      const promisedIds = new Set(plan.responses.filter(({ answer }) => answer === "yes").map(({ memberId }) => memberId));
      const checklist = [...activeMembers].sort((a, b) => Number(promisedIds.has(b.id)) - Number(promisedIds.has(a.id)) || a.username.localeCompare(b.username));
      const yesNotTicked = checklist.filter((member) => promisedIds.has(member.id) && !attendedIds.has(member.id)).map((member) => member.id);
      const rewardOpen = Date.now() - new Date(plan.startsAt).getTime() <= REWARD_WINDOW_MS;
      const needsAttendance = isAdmin && started && attendees.length === 0;
      const confirmedName = (memberId: string) => attendees.find((attendee) => attendee.memberId === memberId)?.member?.username
        || data.members.find((member) => member.id === memberId)?.username
        || plan.participants.find(({ member }) => member.id === memberId)?.member.username
        || t("Former clan member");
      return <section className="planning-panel planning-snipe snipe-card" key={plan.id} aria-label={displaySnipeTitle(plan, t, language)}>
        <div className="planning-heading"><div><h2>{displaySnipeTitle(plan, t, language)}</h2><p className="planning-date"><CalendarDays size={14} /><time dateTime={plan.startsAt}>{utcDateTime(plan.startsAt, language)}</time>{!started && <span className="planning-countdown">{t("in {time}", { time: countdown(new Date(plan.startsAt)) })}</span>}</p></div>{isAdmin && !plan.archived && <div className="planning-inline-actions">{needsAttendance && <span className="planning-chip snipe-needs-attendance">{t("Needs attendance")}</span>}<button className="planning-button planning-button-subtle" onClick={() => { setEditing(editing === plan.id ? null : plan.id); setCreating(false); }} disabled={busy !== null} aria-expanded={editing === plan.id}><Pencil size={14} />{t("Edit plan")}</button><button className="planning-button planning-button-subtle" onClick={() => void archive(plan)} disabled={busy !== null}><Archive size={14} />{t("Archive snipe")}</button></div>}{plan.archived && <div className="planning-inline-actions"><span className="planning-chip">{t("Archived")}</span>{isAdmin && <button className="planning-button planning-button-subtle" onClick={() => void reopen(plan)} disabled={busy !== null}><RotateCcw size={14} />{t("Reopen")}</button>}</div>}</div>
        {editing === plan.id && isAdmin && !plan.archived && <PlanForm key={plan.id} plan={plan} busy={busy !== null} onCancel={() => setEditing(null)} onSave={(draft) => savePlan(draft, plan.id)} />}
        <div className="planning-attendance" aria-label={t("Attendance")}><span className="planning-yes"><Check size={15} />{t("Yes")}: {plan.counts.yes}</span><span className="planning-no"><X size={15} />{t("No")}: {plan.counts.no}</span><span>{t("No answer")}: {plan.counts.unanswered}</span></div>
        {!plan.archived && <details className="planning-response-details"><summary>{t("See who said No or hasn’t answered")}</summary><div className="planning-response-grid"><div><h3>{t("Can’t join")}</h3><p>{unavailable.length ? unavailable.map((member) => member.username).join(", ") : t("Nobody has said No.")}</p></div><div><h3>{t("No answer yet")}</h3><p>{unanswered.length ? unanswered.map((member) => member.username).join(", ") : t("Everyone has answered.")}</p></div></div></details>}
        {/* On now: one tap checks in and gives the week's 10 Clan Points. */}
        {!plan.archived && checkInOpen(plan.startsAt) && <div className="snipe-checkin">
          {attendedIds.has(data.currentUser.id)
            ? <p className="snipe-checked-in"><Check size={18} aria-hidden="true" />{t("You’re checked in. Thanks for joining!")}</p>
            : <button className="planning-button snipe-checkin-button" disabled={busy !== null} onClick={() => void checkIn(plan)}>
              {busy === `checkin:${plan.id}` ? <LoaderCircle size={17} className="spin" /> : <Check size={18} />}{t("Check in now")}<span>{t("+10 points")}</span>
            </button>}
        </div>}
        {!plan.archived && !started && <div className="snipe-calendar">
          <button className="planning-button planning-button-subtle" onClick={() => downloadCalendarFile(`turmoil-snipe-${plan.startsAt.slice(0, 10)}.ics`, snipeCalendarFile(plan, calendarText(plan), `${window.location.origin}/snipes`))}><CalendarPlus size={16} />{t("Add to calendar")}</button>
          <a className="snipe-calendar-google" href={googleCalendarLink(plan, calendarText(plan))} target="_blank" rel="noreferrer">{t("Google Calendar")}</a>
        </div>}
        {!plan.archived && <div className="planning-rsvp"><p>{t(started ? "This snipe has started. Answers are closed." : "Can you join this snipe?")}</p>{!started && <div className="planning-tabs"><button aria-pressed={answer === "yes"} disabled={busy !== null} onClick={() => void respond(plan, "yes")}><Check size={14} />{t("Yes")}</button><button aria-pressed={answer === "no"} disabled={busy !== null} onClick={() => void respond(plan, "no")}><X size={14} />{t("No")}</button></div>}{busy === plan.id && <LoaderCircle size={16} className="spin" aria-label={t("Saving…")} />}</div>}
        <section className="snipe-confirmed-attendance" aria-label={t("Confirmed attendance for {title}", { title: displaySnipeTitle(plan, t, language) })}>
          <div className="snipe-attendance-heading"><h3>{t("Confirmed attendance")}</h3><span className="planning-chip">{t("{count} attended", { count: attendees.length })}</span></div>
          <p className="snipe-attendance-copy">{t("Get 10 Clan Points a week for joining a snipe. Check in here or in Discord, from 30 minutes before it starts.")}</p>
          {attendees.length > 0 ? <ul className="snipe-confirmed-list">{attendees.map((attendee) => <li key={attendee.memberId}><Check size={14} aria-hidden="true" /><span>{confirmedName(attendee.memberId)}</span>{attendee.memberId === data.currentUser.id && <small>{t("You attended")}</small>}</li>)}</ul> : <p className="snipe-attendance-empty">{t(started || plan.archived ? "No attendance has been confirmed." : "Admins confirm attendance after the snipe starts.")}</p>}
          {started && isAdmin && <div className="snipe-attendance-management">
            <h4 className="snipe-checklist-title">{t("Who took part? Tick each member who joined.")}</h4>
            <p className="snipe-attendance-copy">{rewardOpen
              ? t("Each ticked member gets 10 Clan Points for that week (once per week, even across several snipes). Untick to undo, and the points are taken back.")
              : t("This snipe is more than 8 days old, so ticks are saved for the record but don’t give Clan Points.")}</p>
            {yesNotTicked.length > 0 && <button className="planning-button snipe-tick-yes" disabled={busy !== null} onClick={() => void setAttendance(plan, yesNotTicked, true)}>
              {busy === `attendance:${plan.id}:all` ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{t("Tick everyone who said Yes ({count})", { count: yesNotTicked.length })}
            </button>}
            <ul className="snipe-checklist">{checklist.map((member) => {
              const ticked = attendedIds.has(member.id);
              return <li key={member.id} className={ticked ? "ticked" : undefined}>
                <label>
                  <input type="checkbox" checked={ticked} disabled={busy !== null} aria-label={t("{name} attended", { name: member.username })} onChange={() => void setAttendance(plan, [member.id], !ticked)} />
                  <span>{member.username}</span>
                </label>
                {promisedIds.has(member.id) && <small className="snipe-said-yes">{t("said Yes")}</small>}
                {busy === `attendance:${plan.id}:${member.id}` && <LoaderCircle size={13} className="spin" />}
              </li>;
            })}</ul>
          </div>}
        </section>
        <div className="planning-activity-chips" aria-label={t("Include activities")}>{activityLabels.map((activity) => { const Picture = ACTIVITY_ICONS[activity.key]; return <span className="planning-chip planning-activity-chip" key={activity.key}><Picture size={18} />{t(activity.label)}</span>; })}</div>
        <ParticipantsTable plan={plan} activityLabels={activityLabels} meId={data.currentUser.id} />
        <div className="planning-total"><div><span>{t("{count} said Yes", { count: numberFormat(plan.counts.yes) })}</span><small>{t("Estimated snipe points")}</small></div><strong>{points(plan.estimate.minimum, plan.estimate.maximum)}</strong></div>
        {plan.estimate.missingCosts > 0 && <p className="planning-notice">{t("Some members who said Yes are missing summon costs, so part of their resources is left out.")}</p>}
        <p className="planning-footnote">{t(plan.archived ? "Saved as it was when the snipe was archived." : "Only members who said Yes are counted. Uses everyone’s latest saved resources.")}</p>
      </section>;
    })}
  </div>;
}
