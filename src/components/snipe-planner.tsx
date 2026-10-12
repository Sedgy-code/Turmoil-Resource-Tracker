"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, CalendarDays, Check, Crosshair, LoaderCircle, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { WAR_ACTIVITIES } from "@/lib/war";
import type { DashboardResponse, SnipePlan, SnipesResponse, WarActivity } from "@/lib/types";

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

function localInputDate(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startingDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  return localInputDate(tomorrow.toISOString());
}

type PlanDraft = { title: string; startsAt: string; activities: WarActivity[] };

function PlanForm({ plan, busy, onCancel, onSave }: { plan?: SnipePlan; busy: boolean; onCancel: () => void; onSave: (draft: PlanDraft) => Promise<void> }) {
  const [title, setTitle] = useState(plan?.title || "");
  const [startsAt, setStartsAt] = useState(plan ? localInputDate(plan.startsAt) : startingDate);
  const [activities, setActivities] = useState<WarActivity[]>(plan?.activities || ["skillSummons"]);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const date = new Date(startsAt);
    if (!title.trim() || !Number.isFinite(date.getTime()) || !activities.length) {
      setError("Add a title, date and time, and at least one scoring activity.");
      return;
    }
    if (date.getTime() <= Date.now()) {
      setError("Choose a future date and time for this snipe.");
      return;
    }
    setError("");
    await onSave({ title: title.trim(), startsAt: date.toISOString(), activities });
  }
  return <form className="planning-form planning-plan-form" onSubmit={submit}>
    <h3>{plan ? "Edit snipe plan" : "Create a snipe plan"}</h3>
    <div className="planning-form-grid"><label className="planning-field"><span>Snipe title</span><input aria-label="Snipe title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Day 1 · Skills" required /></label><label className="planning-field"><span>Start date and time</span><input aria-label="Start date and time" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /><small>Shown in each member’s local time.</small></label></div>
    <fieldset className="planning-activities"><legend>Scoring activities</legend>{WAR_ACTIVITIES.map(({ key, label }) => <label className="planning-check planning-check-compact" key={key}><input type="checkbox" checked={activities.includes(key)} onChange={() => setActivities((selected) => selected.includes(key) ? selected.filter((activity) => activity !== key) : [...selected, key])} /><span>{label}</span></label>)}</fieldset>
    {error && <p className="planning-notice" role="alert">{error}</p>}
    <div className="planning-form-actions"><button type="button" className="planning-button planning-button-subtle" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="planning-button" disabled={busy}>{busy && <LoaderCircle size={15} className="spin" />}{plan ? "Save plan" : "Create snipe"}</button></div>
  </form>;
}

export function SnipePlanner({ data, notify }: Props) {
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
        setLoadError(error instanceof Error ? error.message : "Unable to load snipe plans.");
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
      notify(id ? "Snipe plan updated." : "Snipe plan created.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to save the snipe plan.", true); }
    finally { finishMutation(); }
  }
  async function respond(plan: SnipePlan, answer: "yes" | "no") {
    if (!beginMutation(plan.id)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}/response`, { method: "POST", body: JSON.stringify({ answer }) });
      replacePlan(result.plan);
      notify(answer === "yes" ? "You’re on the list for this snipe." : "Your response was saved.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to save your response.", true); }
    finally { finishMutation(); }
  }
  async function archive(plan: SnipePlan) {
    if (!beginMutation(plan.id)) return;
    try {
      const result = await request<{ plan: SnipePlan }>(`/api/snipes/${plan.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
      replacePlan(result.plan); setEditing(null); notify("Snipe archived with its attendance and point estimates.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to archive the snipe.", true); }
    finally { finishMutation(); }
  }
  const visible = plans.filter((plan) => plan.archived === (tab === "history")).sort((a, b) => tab === "history" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt));
  return <div className="planning-stack">
    <section className="planning-panel">
      <div className="planning-heading"><div><span className="planning-eyebrow">Show up together</span><h2>Snipe plans</h2><p>Let the clan know you’re coming and see the points available.</p></div><div className="planning-inline-actions"><button className="planning-button planning-button-subtle" aria-label="Refresh plans" onClick={() => void load()} disabled={refreshing || busy !== null}><RefreshCw size={15} className={refreshing ? "spin" : undefined} />Refresh plans</button>{isAdmin && <button className="planning-button" onClick={() => { setCreating((open) => !open); setEditing(null); }} disabled={!loaded || busy !== null} aria-expanded={creating}><Plus size={16} />New snipe</button>}</div></div>
      <div className="planning-controls"><div className="planning-tabs" aria-label="Snipe plans"><button aria-pressed={tab === "open"} onClick={() => setTab("open")}>Open <span aria-hidden="true">{plans.filter((plan) => !plan.archived).length}</span></button><button aria-pressed={tab === "history"} onClick={() => setTab("history")}>History <span aria-hidden="true">{plans.filter((plan) => plan.archived).length}</span></button></div></div>
      {loaded && loadError && <p className="planning-notice" role="status">The latest plans could not be loaded. {loadError} Use Refresh plans to try again.</p>}
      {creating && isAdmin && <PlanForm busy={busy !== null} onCancel={() => setCreating(false)} onSave={(draft) => savePlan(draft)} />}
    </section>
    {!loaded ? <section className="planning-panel planning-state" aria-live="polite">{loadError ? <><h2>Snipe plans are unavailable</h2><p>{loadError}</p><button className="planning-button" onClick={() => void load()}>Try again</button></> : <><LoaderCircle size={24} className="spin" /><p>Loading snipe plans…</p></>}</section> : visible.length === 0 ? <section className="planning-panel planning-state"><Crosshair size={32} className="planning-gold" /><h2>{tab === "history" ? "No archived snipes yet" : "No open snipe plans"}</h2><p>{tab === "history" ? "Completed plans will keep their attendance and estimated points here." : isAdmin ? "Create a plan to collect attendance and prepare the clan." : "Clan leadership will add the next snipe plan here."}</p></section> : visible.map((plan) => {
      const answer = plan.responses.find((response) => response.memberId === data.currentUser.id)?.answer;
      const activityLabels = plan.activities.map((activity) => WAR_ACTIVITIES.find(({ key }) => key === activity)).filter((activity) => activity !== undefined);
      const unavailable = data.members.filter((member) => member.active && plan.responses.some((response) => response.memberId === member.id && response.answer === "no"));
      const unanswered = data.members.filter((member) => member.active && !plan.responses.some((response) => response.memberId === member.id));
      const started = new Date(plan.startsAt).getTime() <= Date.now();
      return <section className="planning-panel planning-snipe snipe-card" key={plan.id} aria-label={plan.title}>
        <div className="planning-heading"><div><h2>{plan.title}</h2><p className="planning-date"><CalendarDays size={14} /><time dateTime={plan.startsAt}>{new Date(plan.startsAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time></p></div>{isAdmin && !plan.archived && <div className="planning-inline-actions"><button className="planning-button planning-button-subtle" onClick={() => { setEditing(editing === plan.id ? null : plan.id); setCreating(false); }} disabled={busy !== null} aria-expanded={editing === plan.id}><Pencil size={14} />Edit plan</button><button className="planning-button planning-button-subtle" onClick={() => void archive(plan)} disabled={busy !== null}><Archive size={14} />Archive snipe</button></div>}{plan.archived && <span className="planning-chip">Archived</span>}</div>
        {editing === plan.id && isAdmin && !plan.archived && <PlanForm key={plan.id} plan={plan} busy={busy !== null} onCancel={() => setEditing(null)} onSave={(draft) => savePlan(draft, plan.id)} />}
        <div className="planning-attendance" aria-label="Attendance"><span className="planning-yes"><Check size={15} />Yes: {plan.counts.yes}</span><span className="planning-no"><X size={15} />No: {plan.counts.no}</span><span>No answer: {plan.counts.unanswered}</span></div>
        {!plan.archived && <details className="planning-response-details"><summary>View unavailable and unanswered members</summary><div className="planning-response-grid"><div><h3>Unable to join</h3><p>{unavailable.length ? unavailable.map((member) => member.username).join(", ") : "No members have answered No."}</p></div><div><h3>Awaiting a response</h3><p>{unanswered.length ? unanswered.map((member) => member.username).join(", ") : "Everyone has responded."}</p></div></div></details>}
        {!plan.archived && <div className="planning-rsvp"><p>{started ? "This snipe has started. Attendance is closed." : "Can you join this snipe?"}</p>{!started && <div className="planning-tabs"><button aria-pressed={answer === "yes"} disabled={busy !== null} onClick={() => void respond(plan, "yes")}><Check size={14} />Yes</button><button aria-pressed={answer === "no"} disabled={busy !== null} onClick={() => void respond(plan, "no")}><X size={14} />No</button></div>}{busy === plan.id && <LoaderCircle size={16} className="spin" aria-label="Saving" />}</div>}
        <div className="planning-activity-chips" aria-label="Selected scoring activities">{activityLabels.map((activity) => <span className="planning-chip" key={activity.key}>{activity.label}</span>)}</div>
        <div className="planning-table-wrap"><table className="planning-table planning-participants"><caption className="planning-sr-only">{plan.title} participating members and war point estimates</caption><thead><tr><th scope="col">Member</th>{activityLabels.map((activity) => <th scope="col" key={activity.key}>{activity.label}</th>)}<th scope="col">Total points</th></tr></thead><tbody>{plan.participants.map(({ member, estimate }) => <tr key={member.id}><th scope="row">{member.username}</th>{activityLabels.map((activity) => { const row = estimate.rows.find((row) => row.activity === activity.key); return <td key={activity.key}>{row ? points(row.minimum, row.maximum) : "0"}</td>; })}<td className="planning-gold">{points(estimate.minimum, estimate.maximum)}</td></tr>)}{plan.participants.length === 0 && <tr><td colSpan={activityLabels.length + 2} className="planning-table-empty">Members who answer Yes will appear here.</td></tr>}</tbody></table></div>
        <div className="planning-total"><div><span>{numberFormat(plan.counts.yes)} {plan.counts.yes === 1 ? "participant" : "participants"}</span><small>Estimated snipe points</small></div><strong>{points(plan.estimate.minimum, plan.estimate.maximum)}</strong></div>
        {plan.estimate.missingCosts > 0 && <p className="planning-notice">Some participating members are missing summon costs. Their affected resources are excluded from this estimate.</p>}
        <p className="planning-footnote">{plan.archived ? "Attendance and estimates are saved as they were when this plan was archived." : "Only Yes responses count toward this estimate. Open plans use the latest saved banks and clan point rates."}</p>
      </section>;
    })}
  </div>;
}
