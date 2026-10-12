"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Settings2, Swords } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { DEFAULT_WAR_RATES, WAR_ACTIVITIES, estimateWar } from "@/lib/war";
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
  const scopeName = scope === "clan" ? "Clan totals" : scope === "mine" ? "My totals" : members.find((member) => member.id === memberId)?.username || "Member";

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
    {loadError ? <><h2>War estimates are unavailable</h2><p>{loadError}</p><button className="planning-button" onClick={() => void load()}>Try again</button></> : <><LoaderCircle className="spin" size={24} /><p>Loading clan war rates…</p></>}
  </section>;

  return <div className="planning-stack">
    <section className="planning-panel">
      <div className="planning-heading"><div><span className="planning-eyebrow">Make every resource count</span><h2>Estimated war points</h2><p>Choose a bank and the activities you plan to use.</p></div><Swords size={28} className="planning-gold" aria-hidden="true" /></div>
      <div className="planning-controls">
        <div className="planning-tabs" aria-label="War estimate scope">
          <button type="button" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>My totals</button>
          <button type="button" aria-pressed={scope === "clan"} onClick={() => setScope("clan")}>Clan totals</button>
          <button type="button" aria-pressed={scope === "member"} onClick={() => setScope("member")}>Individual member</button>
        </div>
        {scope === "member" && <label className="planning-field planning-member-select"><span>Select member</span><select aria-label="Select member" value={memberId} onChange={(event) => setMemberId(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>}
      </div>
      <fieldset className="planning-activities"><legend>Include activities</legend>{WAR_ACTIVITIES.map(({ key, label, description }) => <label key={key} className="planning-check"><input type="checkbox" aria-label={label} checked={activities.includes(key)} onChange={() => toggleActivity(key)} /><span><strong>{label}</strong><small>{key === "hammers" ? `${points(rates.hammersMin, rates.hammersMax)} points per hammer.` : description}</small></span></label>)}</fieldset>
      {estimateError && <p className="planning-notice" role="alert">{estimateError} You can also select fewer activities or view an individual member’s estimate.</p>}
      <div className="planning-table-wrap"><table className="planning-table"><caption className="planning-sr-only">{scopeName} estimated war points</caption><thead><tr><th scope="col">Activity</th><th scope="col">Estimated actions</th><th scope="col">Points each</th><th scope="col">Estimated points</th></tr></thead><tbody>{estimate.rows.map((row) => <tr key={row.activity}><th scope="row">{row.label}</th><td>{numberFormat(row.quantity)}</td><td>{row.activity === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[row.activity])}</td><td className="planning-gold">{points(row.minimum, row.maximum)}</td></tr>)}{estimate.rows.length === 0 && <tr><td colSpan={4} className="planning-table-empty">{estimateError ? "Estimate unavailable until the selected points are reduced." : "Select an activity to calculate an estimate."}</td></tr>}</tbody></table></div>
      <div className="planning-total"><div><span>{scopeName}</span><small>Total selected points</small></div><strong className="war-estimate-total" aria-live="polite">{estimateError ? "--" : points(estimate.minimum, estimate.maximum)}</strong></div>
      {estimate.missingCosts > 0 && <p className="planning-notice" role="status">{numberFormat(estimate.missingCosts)} missing summon {estimate.missingCosts === 1 ? "cost is" : "costs are"} leaving some resources out of this estimate. Add the costs in My Resources to include them.</p>}
      {entries.length === 0 && <p className="planning-notice">No saved resource bank for this selection yet. Save a bank in My Resources to start planning.</p>}
      <p className="planning-footnote">Summons use each member’s saved costs. Bonus mount merges = mount summons × extra mount chance ÷ 100. Existing egg/pet merges use Total eggs/pets, assuming every egg and pet will be ascended when needed. Egg/pet summon then merge = eggshells ÷ 100 × extra pet summon chance ÷ 100. Chances estimate expected actions and can produce fractions; point estimates are rounded to whole points. Summoning and merging are separate scoring actions. {data.live === false && "Older snapshots retain their original saved merge counts."}</p>
    </section>
    <section className="planning-panel">
      <div className="planning-heading"><div><h2>Clan point rates</h2><p>{isAdmin ? "Saved rates apply to every member’s estimates and open snipe plans." : "Your clan leadership sets the point rates used for these estimates."}</p></div>{isAdmin && <button className="planning-button planning-button-subtle" onClick={() => { setRateDraft(rates); setEditingRates((open) => !open); }} aria-expanded={editingRates}><Settings2 size={15} />{editingRates ? "Cancel" : "Edit rates"}</button>}</div>
      {editingRates && isAdmin ? <form onSubmit={saveRates} className="planning-form"><div className="planning-form-grid">{RATE_FIELDS.map(({ key, label }) => <label className="planning-field" key={key}><span>{label}</span><input type="number" min="0" max="100000" step="1" required value={rateDraft[key]} onChange={(event) => setRateDraft((draft) => ({ ...draft, [key]: Number(event.target.value) }))} /></label>)}</div><div className="planning-form-actions"><button type="submit" className="planning-button" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Save point rates</button></div></form> : <div className="planning-rate-list">{WAR_ACTIVITIES.map(({ key, label }) => <div key={key}><span>{label}</span><strong>{key === "hammers" ? points(rates.hammersMin, rates.hammersMax) : numberFormat(rates[key])}</strong></div>)}</div>}
    </section>
  </div>;
}
