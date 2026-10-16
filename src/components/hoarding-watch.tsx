"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, NotebookPen, RefreshCw } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { HoardingLevel, HoardingReason, HoardingResponse, HoardingRow, HoardingRules, WarSpendingResponse, WarSpendingRow } from "@/lib/types";
import { currentWeek, formatWeek, shiftWeek } from "@/lib/resources";
import { useSortable } from "./sortable";
import { MemberAvatar, MemberName } from "./member-identity";
import "./hoarding-watch.css";

const LEVELS: Record<HoardingLevel, string> = { high: "Hoarding", watch: "Keep an eye on", saver: "💰 Good saver", ok: "OK" };
const REASONS: Record<HoardingReason, string> = {
  large: "Holds at least {times}× as much as a typical member",
  growing: "Pile keeps growing with no spending in 4 weeks",
  skipsSnipes: "Missed every snipe with ticked attendance (last 8 weeks)",
  stale: "Hasn’t saved resources in over 2 weeks",
  noWarSpending: "Used less than {percent}% of their pile in the last {wars} war(s)",
  spendsInWars: "Saves up, but uses it in wars ({used}% in the last {wars} war(s))",
};

function RulesEditor({ rules, measuredWars, onSaved, notify }: { rules: HoardingRules; measuredWars: number; onSaved: () => void; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(rules);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(rules), [rules]);
  const changed = draft.largeMultiple !== rules.largeMultiple || draft.spendPercent !== rules.spendPercent || draft.wars !== rules.wars;
  async function save() {
    setSaving(true);
    try {
      await request("/api/hoarding/rules", { method: "PUT", body: JSON.stringify(draft) });
      notify(t("Hoarding rules saved."));
      onSaved();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Please try again.";
      notify(t(text), true);
    } finally { setSaving(false); }
  }
  const field = (key: keyof HoardingRules, label: string, min: number, max: number, step: number, suffix: string) => <label className="rule-field">
    <span>{label}</span>
    <span className="rule-input"><input type="number" min={min} max={max} step={step} value={draft[key]} onChange={(event) => setDraft((old) => ({ ...old, [key]: Number(event.target.value) }))} />{suffix}</span>
  </label>;
  return <section className="panel hoard-rules">
    <h2>{t("Saver or hoarder? Your rules")}</h2>
    <p>{t("Saving is fine. Someone only counts as hoarding when all three are true: they hold a lot, their pile keeps growing, and they barely used it in recent wars. Big holders who do spend in wars are marked as good savers.")}</p>
    <div className="rule-grid">
      {field("largeMultiple", t("Holds at least … × a typical member"), 1, 20, 0.5, "×")}
      {field("spendPercent", t("Must use at least … of their pile in wars"), 0, 100, 5, "%")}
      {field("wars", t("Looking at the last … wars"), 1, 10, 1, "")}
    </div>
    {measuredWars === 0 && <p className="war-hint">{t("No war results saved yet, so nobody can be called a hoarder yet. Add war results after each war.")}</p>}
    {changed && <button className="button primary" disabled={saving} onClick={() => void save()}>{saving && <LoaderCircle size={14} className="spin" />}{t("Save rules")}</button>}
  </section>;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result as T;
}

function daysAgo(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : null;
}

function NoteEditor({ row, onSaved, notify }: { row: HoardingRow; onSaved: (note: string) => void; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.note);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(row.note), [row.note]);
  async function save() {
    setSaving(true);
    try {
      const result = await request<{ note: string }>("/api/hoarding/notes", { method: "PUT", body: JSON.stringify({ memberId: row.member.id, note: text }) });
      onSaved(result.note);
      setOpen(false);
      notify(t("Note saved. Only admins can see it."));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      notify(t(message), true);
    } finally { setSaving(false); }
  }
  if (!open) return <div className="hoard-note">
    {row.note ? <p>{row.note}{row.noteBy && <small> — {row.noteBy}</small>}</p> : null}
    <button className="text-link" onClick={() => setOpen(true)}><NotebookPen size={13} />{row.note ? t("Edit note") : t("Add note")}</button>
  </div>;
  return <div className="hoard-note hoard-note-editing">
    <textarea aria-label={t("Private admin note about {name}", { name: row.member.username })} maxLength={1000} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("e.g. Asked to spend in the next war")} />
    <div className="hoard-note-actions">
      <button className="button subtle" disabled={saving} onClick={() => { setText(row.note); setOpen(false); }}>{t("Cancel")}</button>
      <button className="button primary" disabled={saving} onClick={() => void save()}>{saving && <LoaderCircle size={14} className="spin" />}{t("Save note")}</button>
    </div>
  </div>;
}

/** One war week: who held back (saved) and who spent the most. */
function WarSpending() {
  const t = useT();
  const [week, setWeek] = useState(() => currentWeek());
  const [data, setData] = useState<WarSpendingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    request<WarSpendingResponse>(`/api/hoarding/war?week=${week}`)
      .then((result) => { if (current) setData(result); })
      .catch((e) => { if (current) setError(e instanceof Error ? e.message : "Please try again."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [week]);
  const recentWeeks = Array.from({ length: 8 }, (_, index) => shiftWeek(currentWeek(), -index));
  const options = [...new Set([...(data?.warWeeks ?? []), ...recentWeeks, week])].sort().reverse();
  const known = (data?.rows ?? []).filter((row) => row.spent !== null);
  const mostSaved = [...known].sort((a, b) => a.spent! - b.spent!).slice(0, 5);
  const mostSpent = [...known].sort((a, b) => b.spent! - a.spent!).slice(0, 5);
  const notUpdated = (data?.rows ?? []).filter((row) => row.before !== null && row.after === null);
  const { sorted, header } = useSortable<WarSpendingRow, "member" | "before" | "after" | "spent" | "war">(data?.rows ?? [], {
    member: (row) => row.member.username,
    before: (row) => row.before,
    after: (row) => row.after,
    spent: (row) => row.spent,
    war: (row) => row.warPoints,
  }, { key: "spent", direction: "desc" });
  const amount = (value: number | null) => value === null ? "—" : numberFormat(Math.round(value));
  const list = (rows: WarSpendingRow[], kind: "saved" | "spent") => rows.length ? <ol className="champion-list">{rows.map((row) => <li key={row.member.id}>
    <MemberAvatar member={row.member} small /><strong><MemberName member={row.member} /></strong>
    <span className={`champion-count ${kind === "saved" ? "hoard-up" : "hoard-down"}`}>{row.spent! > 0 ? "−" : "+"}{numberFormat(Math.abs(Math.round(row.spent!)))}</span>
  </li>)}</ol> : <p className="recognition-empty">{t("Not enough saves around this war yet.")}</p>;
  return <section className="panel war-spend">
    <div className="war-spend-head">
      <div>
        <h2>{t("During a war")}</h2>
        <p>{t("Hard war? Check “Most saved” — they held back. Easy war? Check “Most spent” — they may have wasted resources.")}</p>
      </div>
      <label className="war-spend-week"><span>{t("War week")}</span>
        <select value={week} onChange={(event) => setWeek(event.target.value)}>
          {options.map((item) => <option key={item} value={item}>{t("Week of {date}", { date: formatWeek(item) })}{data?.warWeeks.includes(item) ? " 🏆" : ""}</option>)}
        </select>
      </label>
    </div>
    {error ? <p className="war-message">{t(error)}</p> : !data || loading ? <LoaderCircle size={20} className="spin" /> : <>
      <div className="recognition-row war-spend-lists">
        <div><h3>{t("Most saved")}</h3><p className="recognition-sub">{t("Holdings grew the most during this war.")}</p>{list(mostSaved.filter((row) => row.spent! < 0), "saved")}</div>
        <div><h3>{t("Most spent")}</h3><p className="recognition-sub">{t("Holdings dropped the most during this war.")}</p>{list(mostSpent.filter((row) => row.spent! > 0), "spent")}</div>
      </div>
      {notUpdated.length > 0 && <p className="war-hint">{t("Not updated since the war started: {names}", { names: notUpdated.map((row) => row.member.username).join(", ") })}</p>}
      <details className="war-members">
        <summary>{t("Everyone ({count})", { count: data.rows.length })}</summary>
        <div className="table-scroll"><table className="resource-table">
          <thead><tr>{header("member", t("Member"))}{header("before", t("Before the war"))}{header("after", t("After the war"))}{header("spent", t("Spent"))}{header("war", t("War points"))}</tr></thead>
          <tbody>{sorted.map((row) => <tr key={row.member.id}>
            <td><MemberName member={row.member} /></td>
            <td>{amount(row.before)}</td>
            <td>{row.after === null ? t("Not updated") : amount(row.after)}</td>
            <td className={row.spent === null || row.spent === 0 ? "" : row.spent > 0 ? "hoard-down" : "hoard-up"}>{row.spent === null ? "—" : `${row.spent > 0 ? "−" : "+"}${numberFormat(Math.abs(Math.round(row.spent)))}`}</td>
            <td>{amount(row.warPoints)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
      <p className="war-hint">{t("Amounts are estimated war points of everything a member holds, from their saves before and after the war week.")}</p>
    </>}
  </section>;
}

export function HoardingWatch({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [report, setReport] = useState<HoardingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"flagged" | "savers" | "all">("flagged");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setReport(await request<HoardingResponse>("/api/hoarding")); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!report) return <section className="panel hoard-state">{error ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></> : <LoaderCircle size={24} className="spin" />}</section>;
  const flagged = report.rows.filter((row) => row.level === "high" || row.level === "watch");
  const savers = report.rows.filter((row) => row.level === "saver");
  const rows = filter === "flagged" ? flagged : filter === "savers" ? savers : report.rows;
  const updateNote = (memberId: string, note: string) => setReport((current) => current && ({
    ...current, rows: current.rows.map((row) => row.member.id === memberId ? { ...row, note, noteBy: note ? row.noteBy : null } : row),
  }));
  return <div className="hoard-page">
    <section className="panel hoard-intro">
      <div>
        <h2>{t("How this works")}</h2>
        <p>{t("Each member’s resources are turned into estimated war points so everyone can be compared. Members are flagged when they hold a lot, keep growing without spending, or miss snipes. It’s a guide — check with the member before acting.")}</p>
        <p className="hoard-typical">{t("A typical member holds about {points} war points.", { points: numberFormat(Math.round(report.typicalWarValue)) })}</p>
      </div>
      <button className="button subtle" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : undefined} />{t("Refresh")}</button>
    </section>
    <RulesEditor rules={report.rules} measuredWars={report.measuredWars} notify={notify} onSaved={() => void load()} />
    <WarSpending />
    <div className="table-tabs hoard-tabs">
      <button className={filter === "flagged" ? "active" : ""} onClick={() => setFilter("flagged")}>{t("Flagged")}<span>{flagged.length}</span></button>
      <button className={filter === "savers" ? "active" : ""} onClick={() => setFilter("savers")}>{t("Good savers")}<span>{savers.length}</span></button>
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{t("All members")}<span>{report.rows.length}</span></button>
    </div>
    {rows.length === 0 ? <section className="panel hoard-state"><p>{t("Nobody is flagged right now.")}</p></section> : <div className="hoard-list">
      {rows.map((row) => {
        const saved = daysAgo(row.lastSavedAt);
        const spent = daysAgo(row.lastSpendAt);
        return <article key={row.member.id} className={`panel hoard-card hoard-${row.level}`}>
          <header>
            <MemberAvatar member={row.member} small />
            <strong><MemberName member={row.member} /></strong>
            <span className={`hoard-level hoard-level-${row.level}`}>{t(LEVELS[row.level])}</span>
          </header>
          <dl className="hoard-facts">
            <div><dt>{t("Holding (war points)")}</dt><dd>{numberFormat(Math.round(row.warValue))}{row.timesTypical !== null && <small>{t("{times}× typical", { times: row.timesTypical.toFixed(1) })}</small>}</dd></div>
            <div><dt>{t("Last 4 weeks")}</dt><dd className={row.change !== null && row.change > 0 ? "hoard-up" : row.change !== null && row.change < 0 ? "hoard-down" : undefined}>{row.change === null ? t("Not enough history") : `${row.change > 0 ? "+" : ""}${numberFormat(Math.round(row.change))}`}</dd></div>
            <div><dt>{t("Last spent")}</dt><dd>{spent === null ? t("Never seen") : t("{days} days ago", { days: spent })}</dd></div>
            <div><dt>{t("Snipes attended")}</dt><dd>{row.snipes.held ? `${row.snipes.attended} / ${row.snipes.held}` : "—"}</dd></div>
            <div><dt>{t("Used in wars")}</dt><dd>{row.warUsePercent === null ? "—" : `${row.warUsePercent}%`}</dd></div>
            <div><dt>{t("Last saved")}</dt><dd>{saved === null ? t("Never") : t("{days} days ago", { days: saved })}</dd></div>
          </dl>
          {row.reasons.length > 0 && <ul className="hoard-reasons">{row.reasons.map((reason) => <li key={reason} className={reason === "spendsInWars" ? "hoard-good" : undefined}>{t(REASONS[reason], { times: report.rules.largeMultiple, percent: report.rules.spendPercent, wars: report.measuredWars, used: row.warUsePercent ?? 0 })}</li>)}</ul>}
          <NoteEditor row={row} notify={notify} onSaved={(note) => updateNote(row.member.id, note)} />
        </article>;
      })}
    </div>}
  </div>;
}
