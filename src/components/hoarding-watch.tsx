"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, NotebookPen, RefreshCw } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { HoardingLevel, HoardingReason, HoardingResponse, HoardingRow } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import "./hoarding-watch.css";

const LEVELS: Record<HoardingLevel, string> = { high: "Hoarding", watch: "Keep an eye on", ok: "OK" };
const REASONS: Record<HoardingReason, string> = {
  large: "Holds at least twice as much as a typical member",
  growing: "Pile keeps growing with no spending in 4 weeks",
  skipsSnipes: "Missed every snipe with ticked attendance (last 8 weeks)",
  stale: "Hasn’t saved resources in over 2 weeks",
};

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

export function HoardingWatch({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [report, setReport] = useState<HoardingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"flagged" | "all">("flagged");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setReport(await request<HoardingResponse>("/api/hoarding")); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!report) return <section className="panel hoard-state">{error ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></> : <LoaderCircle size={24} className="spin" />}</section>;
  const flagged = report.rows.filter((row) => row.level !== "ok");
  const rows = filter === "flagged" ? flagged : report.rows;
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
    <div className="table-tabs hoard-tabs">
      <button className={filter === "flagged" ? "active" : ""} onClick={() => setFilter("flagged")}>{t("Flagged")}<span>{flagged.length}</span></button>
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
            <div><dt>{t("Last saved")}</dt><dd>{saved === null ? t("Never") : t("{days} days ago", { days: saved })}</dd></div>
          </dl>
          {row.reasons.length > 0 && <ul className="hoard-reasons">{row.reasons.map((reason) => <li key={reason}>{t(REASONS[reason])}</li>)}</ul>}
          <NoteEditor row={row} notify={notify} onSaved={(note) => updateNote(row.member.id, note)} />
        </article>;
      })}
    </div>}
  </div>;
}
