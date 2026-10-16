"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Settings2, Swords } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { DEFAULT_WAR_RATES, WAR_ACTIVITIES, estimateWar } from "@/lib/war";
import { useT } from "@/lib/i18n";
import type { ClanSettings, DashboardResponse, WarActivity, WarEstimate, WarRates } from "@/lib/types";

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

const RATE_FIELDS: { key: keyof WarRates; label: string }[] = [
  { key: "hammersMin", label: "Hammers minimum points" },
  { key: "hammersMax", label: "Hammers maximum points" },
  ...WAR_ACTIVITIES.filter(({ key }) => key !== "hammers").map(({ key, label }) => ({
    key: key as keyof WarRates,
    label: `${label} points`,
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
      setLoadError(error instanceof Error ? error.message : "Unable to load war rates.");
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
        estimateError: error instanceof Error ? error.message : "Unable to calculate this estimate. Reduce the selected activities or saved resource counts.",
      };
    }
  }, [entries, rates, activities, data.live]);
  const scopeName = scope === "clan" ? t("Clan totals") : scope === "mine" ? t("My totals") : members.find((member) => member.id === memberId)?.username || t("Member");

  function toggleActivity(activity: WarActivity) {
    setActivities((selected) => selected.includes(activity) ? selected.filter((key) => key !== activity) : [...selected, activity]);
  }

  async function saveRates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Object.values(rateDraft).some((value) => !Number.isFinite(value) || value < 0) || rateDraft.hammersMax < rateDraft.hammersMin) {
      notify("Use nonnegative point rates, with the hammer maximum at least its minimum.", true);
      return;
    }
    setSaving(true);
    try {
      const result = await request<{ settings: ClanSettings }>("/api/settings", { method: "PATCH", body: JSON.stringify({ warRates: rateDraft }) });
      setRates(result.settings.warRates);
      setRateDraft(result.settings.warRates);
      setEditingRates(false);
      notify("Clan war point rates saved.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to save point rates.", true);
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
      <fieldset className="planning-activities"><legend>{t("Include activities")}</legend>{WAR_ACTIVITIES.map(({ key, label, description }) => <label key={key} className="planning-check"><input type="checkbox" aria-label={t(label)} checked={activities.includes(key)} onChange={() => toggleActivity(key)} /><span><strong>{t(label)}</strong><small>{key === "hammers" ? t("{points} points per hammer.", { points: points(rates.hammersMin, rates.hammersMax) }) : t(description)}</small></span></label>)}</fieldset>
      {estimateError && <p className="planning-notice" role="alert">{t(estimateError)} {t("Try selecting fewer activities or one member.")}</p>}
      <div className="planning-table-wrap"><table className="planning-table"><caption className="planning-sr-only">{scopeName} · {t("Estimated war points")}</caption><thead><tr><th scope="col">{t("Activity")}</th><th scope="col">{t("Estimated actions")}</th><th scope="col">{t("Points each")}</th><th scope="col">{t("Estimated points")}</th></tr></thead><tbody>{estimate.rows.map((row) => <tr key={row.activity}><th scope="row">{t(row.label)}</th><td>{numberFormat(row.quantity)}</td><td>{row.activity === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[row.activity])}</td><td className="planning-gold">{points(row.minimum, row.maximum)}</td></tr>)}{estimate.rows.length === 0 && <tr><td colSpan={4} className="planning-table-empty">{t(estimateError ? "Estimate unavailable until the selected points are reduced." : "Select an activity to calculate an estimate.")}</td></tr>}</tbody></table></div>
      <div className="planning-total"><div><span>{scopeName}</span><small>{t("Total selected points")}</small></div><strong className="war-estimate-total" aria-live="polite">{estimateError ? "--" : points(estimate.minimum, estimate.maximum)}</strong></div>
      {estimate.missingCosts > 0 && <p className="planning-notice" role="status">{t("{count} summon cost(s) missing, so some resources are left out. Add them in My Resources.", { count: numberFormat(estimate.missingCosts) })}</p>}
      {entries.length === 0 && <p className="planning-notice">{t("No saved resources yet. Save yours in My Resources first.")}</p>}
      <p className="planning-footnote">{t("Summons use each member’s saved costs. Bonus mount merges = mount summons × extra mount chance ÷ 100. Existing egg/pet merges use Total eggs/pets. Egg/pet summon then merge = eggshells ÷ 100 × extra pet summon chance ÷ 100. Bonus numbers are averages, so points are rounded.")} {data.live === false && t("Older weeks keep their original saved merge counts.")}</p>
    </section>
    <section className="planning-panel">
      <div className="planning-heading"><div><h2>{t("Clan point rates")}</h2><p>{isAdmin ? "Saved rates apply to every member’s estimates and open snipe plans." : t("Clan leadership sets these point rates.")}</p></div>{isAdmin && <button className="planning-button planning-button-subtle" onClick={() => { setRateDraft(rates); setEditingRates((open) => !open); }} aria-expanded={editingRates}><Settings2 size={15} />{editingRates ? "Cancel" : "Edit rates"}</button>}</div>
      {editingRates && isAdmin ? <form onSubmit={saveRates} className="planning-form"><div className="planning-form-grid">{RATE_FIELDS.map(({ key, label }) => <label className="planning-field" key={key}><span>{label}</span><input type="number" min="0" max="100000" step="1" required value={rateDraft[key]} onChange={(event) => setRateDraft((draft) => ({ ...draft, [key]: Number(event.target.value) }))} /></label>)}</div><div className="planning-form-actions"><button type="submit" className="planning-button" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Save point rates</button></div></form> : <div className="planning-rate-list">{WAR_ACTIVITIES.map(({ key, label }) => <div key={key}><span>{t(label)}</span><strong>{key === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[key])}</strong></div>)}</div>}
    </section>
  </div>;
}
