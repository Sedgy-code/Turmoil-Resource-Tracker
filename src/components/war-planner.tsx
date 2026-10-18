"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "@/lib/error-text";
import { Check, LoaderCircle, Settings2, Swords } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { DEFAULT_WAR_RATES, WAR_ACTIVITIES, estimateWar } from "@/lib/war";
import { ACTIVITY_ICONS } from "./resource-icons";
import { useT } from "@/lib/i18n";
import type { ClanSettings, DashboardResponse, WarActivity, WarEstimate, WarRates } from "@/lib/types";
import { useSortable } from "./sortable";

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
  return minimum === maximum
    ? numberFormat(minimum)
    : `${numberFormat(minimum)}–${numberFormat(maximum)}`;
}

/** Rate boxes for leaders: hammers have a low and high rate, every other activity one. */
const RATE_FIELDS: { key: keyof WarRates; label: string; activity?: string }[] = [
  { key: "hammersMin", label: "Hammers minimum points" },
  { key: "hammersMax", label: "Hammers maximum points" },
  ...WAR_ACTIVITIES.filter(({ key }) => key !== "hammers").map(({ key, label }) => ({
    key: key as keyof WarRates,
    label: "{activity}: points each",
    activity: label,
  })),
];

export function WarPlanner({ data, notify }: Props) {
  const t = useT();
  const [scope, setScope] = useState<"mine" | "clan" | "member">("mine");
  const [memberId, setMemberId] = useState(data.currentUser.id);
  const [activities, setActivities] = useState<WarActivity[]>(WAR_ACTIVITIES.map(({ key }) => key));
  const [rates, setRates] = useState<WarRates>(DEFAULT_WAR_RATES);
  const [rateDraft, setRateDraft] = useState<WarRates>(DEFAULT_WAR_RATES);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingRates, setEditingRates] = useState(false);
  const isAdmin = data.currentUser.role === "ADMIN";

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const result = await request<{ settings: ClanSettings }>("/api/settings");
      setRates(result.settings.warRates);
      setRateDraft(result.settings.warRates);
      setLoaded(true);
    } catch (error) {
      setLoadError(errorText(error, "Unable to load war rates."));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const members = useMemo(() => [...data.members].filter((member) => member.active).sort((a, b) => a.username.localeCompare(b.username)), [data.members]);
  const entries = useMemo(() => {
    const active = new Set(members.map((member) => member.id));
    if (scope === "clan") return data.entries.filter((entry) => active.has(entry.memberId));
    return data.entries.filter((entry) => entry.memberId === (scope === "mine" ? data.currentUser.id : memberId));
  }, [data.entries, data.currentUser.id, memberId, members, scope]);
  const { estimate, estimateError } = useMemo((): { estimate: WarEstimate; estimateError: string } => {
    try {
      return { estimate: estimateWar(entries, rates, activities, data.live === false ? "historical" : "current"), estimateError: "" };
    } catch (error) {
      return {
        estimate: { rows: [], minimum: 0, maximum: 0, missingCosts: 0 },
        estimateError: errorText(error, "Unable to calculate this estimate. Reduce the selected activities or saved resource counts."),
      };
    }
  }, [entries, rates, activities, data.live]);
  const { sorted: sortedRows, header: rowHeader } = useSortable<WarEstimate["rows"][number], "activity" | "actions" | "each" | "points">(estimate.rows, {
    activity: (row) => t(row.label),
    actions: (row) => row.quantity,
    each: (row) => row.activity === "hammers" ? rates.hammersMin : rates[row.activity],
    points: (row) => row.minimum,
  }, { key: "points", direction: "desc" });
  const scopeName = scope === "clan" ? t("Clan totals") : scope === "mine" ? t("My totals") : members.find((member) => member.id === memberId)?.username || t("Member");

  function toggleActivity(activity: WarActivity) {
    setActivities((selected) => selected.includes(activity) ? selected.filter((key) => key !== activity) : [...selected, activity]);
  }

  async function saveRates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(rateDraft).some((value) => !Number.isFinite(value) || value < 0) || rateDraft.hammersMax < rateDraft.hammersMin) {
      notify(t("Use point rates of 0 or more, with the hammer maximum at least its minimum."), true);
      return;
    }
    setSaving(true);
    try {
      const result = await request<{ settings: ClanSettings }>("/api/settings", { method: "PATCH", body: JSON.stringify({ warRates: rateDraft }) });
      setRates(result.settings.warRates);
      setRateDraft(result.settings.warRates);
      setEditingRates(false);
      notify(t("Clan war point rates saved."));
    } catch (error) {
      notify(t(errorText(error)), true);
    } finally { setSaving(false); }
  }

  if (!loaded) return <section className="planning-panel planning-state" aria-live="polite">
    {loadError ? <><h2>{t("War estimates are unavailable")}</h2><p>{t(loadError)}</p><button className="planning-button" onClick={() => void load()}>{t("Try again")}</button></> : <><LoaderCircle className="spin" size={24} /><p>{t("Loading…")}</p></>}
  </section>;

  return <div className="planning-stack">
    <section className="planning-panel">
      <div className="planning-heading"><div><h2>{t("Estimated war points")}</h2><p>{t("Choose whose resources to use and which activities to count.")}</p></div><Swords size={28} className="planning-gold" aria-hidden="true" /></div>
      <div className="planning-controls">
        <div className="planning-tabs" aria-label={t("Estimated war points")}>
          <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{t("My totals")}</button>
          <button type="button" aria-pressed={scope === "clan"} onClick={() => setScope("clan")}>{t("Clan totals")}</button>
          <button type="button" aria-pressed={scope === "member"} onClick={() => setScope("member")}>{t("Individual member")}</button>
        </div>
        {scope === "member" && <label className="planning-field planning-member-select"><span>{t("Select member")}</span><select aria-label={t("Select member")} value={memberId} onChange={(event) => setMemberId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>}
      </div>
      {/* The answer first: whose points, and how many. */}
      <div className="planning-total war-estimate-answer"><div><span>{scopeName}</span><small>{t("Total selected points")}</small></div><strong className="war-estimate-total" aria-live="polite">{estimateError ? "--" : points(estimate.minimum, estimate.maximum)}</strong></div>
      <fieldset className="planning-activities"><legend>{t("Include activities")}</legend>{WAR_ACTIVITIES.map(({ key, label, description }) => { const Picture = ACTIVITY_ICONS[key]; return <label key={key} className="planning-check"><input type="checkbox" aria-label={t(label)} checked={activities.includes(key)} onChange={() => toggleActivity(key)} /><Picture size={30} className="planning-check-icon" /><span><strong>{t(label)}</strong><small>{key === "hammers" ? t("{points} points per hammer.", { points: points(rates.hammersMin, rates.hammersMax) }) : t(description)}</small></span></label>; })}</fieldset>
      {estimateError && <p className="planning-notice" role="alert">{t(estimateError)} {t("Try selecting fewer activities or one member.")}</p>}
      <div className="planning-table-wrap"><table className="planning-table stack-table"><caption className="planning-sr-only">{scopeName} · {t("Estimated war points")}</caption><thead><tr>{rowHeader("activity", t("Activity"))}{rowHeader("actions", t("Estimated actions"))}{rowHeader("each", t("Points each"))}{rowHeader("points", t("Estimated points"))}</tr></thead><tbody>{sortedRows.map((row) => <tr key={row.activity}><th scope="row" className="stack-title">{(() => { const Picture = ACTIVITY_ICONS[row.activity]; return <span className="activity-name"><Picture size={22} />{t(row.label)}</span>; })()}</th><td data-label={t("Estimated actions")}>{numberFormat(row.quantity)}</td><td data-label={t("Points each")}>{row.activity === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[row.activity])}</td><td className="planning-gold" data-label={t("Estimated points")}>{points(row.minimum, row.maximum)}</td></tr>)}{estimate.rows.length === 0 && <tr><td colSpan={4} className="planning-table-empty">{t(estimateError ? "Estimate unavailable until the selected points are reduced." : "Select an activity to calculate an estimate.")}</td></tr>}</tbody></table></div>
      {estimate.missingCosts > 0 && <p className="planning-notice" role="status">{t("{count} summon cost(s) missing, so some resources are left out. Add them in My Resources.", { count: numberFormat(estimate.missingCosts) })}</p>}
      {entries.length === 0 && <p className="planning-notice">{t("No saved resources yet. Save yours in My Resources first.")}</p>}
      <details className="planning-howto"><summary>{t("How is this worked out?")}</summary><p className="planning-footnote">{t("Summons use each member’s saved costs. Bonus mount merges = mount summons × extra mount chance ÷ 100. Existing egg/pet merges use Total eggs/pets. Egg/pet summon then merge = eggshells ÷ 100 × extra pet summon chance ÷ 100. Bonus numbers are averages, so points are rounded.")} {data.live === false && t("Older weeks keep their original saved merge counts.")}</p></details>
    </section>
    <section className="planning-panel">
      <div className="planning-heading"><div><h2>{t("Clan point rates")}</h2><p>{isAdmin ? t("Saved rates apply to every member’s estimates and open snipe plans.") : t("Clan leadership sets these point rates.")}</p></div>{isAdmin && <button className="planning-button planning-button-subtle" onClick={() => { setRateDraft(rates); setEditingRates((open) => !open); }} aria-expanded={editingRates}><Settings2 size={15} />{editingRates ? t("Cancel") : t("Edit rates")}</button>}</div>
      {editingRates && isAdmin ? <form onSubmit={saveRates} className="planning-form"><div className="planning-form-grid">{RATE_FIELDS.map(({ key, label, activity }) => <label className="planning-field" key={key}><span>{t(label, activity ? { activity: t(activity) } : undefined)}</span><input type="number" min="0" max="100000" step="1" required value={rateDraft[key]} onChange={(event) => setRateDraft((draft) => ({ ...draft, [key]: Number(event.target.value) }))} /></label>)}</div><div className="planning-form-actions"><button type="submit" className="planning-button" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{t("Save point rates")}</button></div></form> : <div className="planning-rate-list">{WAR_ACTIVITIES.map(({ key, label }) => { const Picture = ACTIVITY_ICONS[key]; return <div key={key}><span className="activity-name"><Picture size={20} />{t(label)}</span><strong>{key === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[key])}</strong></div>; })}</div>}
    </section>
  </div>;
}
