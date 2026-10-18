"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { formatWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member, WarDayReport, WarDayRow, WarResult } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { RecordEditor, request, TEXT } from "./record-editor";
import { useSortable } from "./sortable";

const DAYS = [1, 2, 3, 4, 5];

/**
 * Daily war points: leadership uploads the clan war screen once per war day. The table shows who
 * scored on which day; points on days that weren't clan days are highlighted (and earn a black mark
 * in the ranking when they're more than a small share of that member's points).
 */
export function WarDaily({ members, admin, notify }: { members: Member[]; admin: boolean; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const words = TEXT.warday;
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<WarDayReport | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ day: number; existing?: WarResult } | null>(null);
  const load = useCallback(async () => {
    try {
      setReport(await request<WarDayReport>(`/api/war-days/report${week ? `?week=${week}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
  }, [week]);
  useEffect(() => { void load(); }, [load]);
  // Members see the latest war with daily uploads when the current one has none yet.
  useEffect(() => {
    if (!admin && !week && report && !report.uploads.length && report.weeks.length) setWeek(report.weeks[0]);
  }, [admin, week, report]);


  async function remove(upload: WarResult) {
    if (!window.confirm(t(words.confirmDelete))) return;
    try {
      await request(`/api/war-results/${upload.id}`, { method: "DELETE" });
      notify(t(words.deleted));
      await load();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Please try again.";
      notify(t(text), true);
    }
  }

  if (!report) return error ? <div className="error-banner" role="alert">{t(error)}<button onClick={() => void load()}>{t("Retry")}</button></div> : null;
  // Nothing uploaded yet and nobody who could upload: nothing to show members.
  if (!admin && !report.uploads.length && !report.weeks.length) return null;
  const weeks = report.weeks.includes(report.week) ? report.weeks : [report.week, ...report.weeks];
  return <section className="panel war-card war-daily">
    <header>
      <div>
        <h2>{t("Daily war points")}</h2>
        <p>{admin ? t("Upload the clan war screenshot before each war day ends (00:00 UTC). Points on clan days count; points on other days earn a black mark.") : t("Each war day’s points, from the clan war screenshot. Points on clan days count; points on other days earn a black mark.")}</p>
      </div>
      {weeks.length > 1 && <select className="war-daily-week" aria-label={t("Week of {date}", { date: formatWeek(report.week) })} value={report.week} onChange={(event) => setWeek(event.target.value)}>
        {weeks.map((item) => <option key={item} value={item}>{t("Week of {date}", { date: formatWeek(item) })}</option>)}
      </select>}
    </header>
    {!report.clanDays.length && <p className="war-message">{t("No clan days picked for this war yet. Leadership can pick them on War → This Week.")}</p>}
    {admin && <div className="war-daily-days">{DAYS.map((day) => {
      const upload = report.uploads.find((item) => item.warDay === day);
      return <span className="war-daily-day" key={day}>
        <button className={upload ? "button subtle" : "button secondary"} onClick={() => setEditing({ day, existing: upload })}>
          {upload ? <Pencil size={14} /> : <Plus size={14} />}{t("Day {day}", { day })}
          {upload && <small>{t("{count} players", { count: upload.points.length })}</small>}
        </button>
        {upload && <button className="icon-button" aria-label={`${t("Delete")}: ${t("Day {day}", { day })}`} onClick={() => void remove(upload)}><Trash2 size={14} /></button>}
      </span>;
    })}</div>}
    {admin && editing && <RecordEditor key={`${editing.day}-${editing.existing?.id ?? "new"}`} kind="warday" warDay={editing.day} week={report.week}
      existing={editing.existing} members={members} notify={notify}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
    {report.uploads.length > 0 && <WarDayTable key={`${report.week}-${report.clanDays.join(",")}`} report={report} admin={admin} />}
  </section>;
}

/** Sorted so the members who scored on other days come first (once clan days are picked). */
function WarDayTable({ report, admin }: { report: WarDayReport; admin: boolean }) {
  const t = useT();
  const clanDays = report.clanDays;
  const picked = clanDays.length > 0;
  const { sorted, header } = useSortable<WarDayRow, "member" | "on" | "other">(report.rows, {
    member: (row) => row.member?.username ?? row.name,
    on: (row) => row.onClanDays,
    other: (row) => row.otherDays,
  }, picked ? { key: "other", direction: "desc" } : { key: "member", direction: "asc" });
  return <div className="table-scroll"><table className="resource-table war-table war-daily-table">
      <thead><tr>
        {header("member", t("Member"))}
        {DAYS.map((day) => <th key={day} className={clanDays.includes(day) ? "war-daily-clan" : undefined}>
          {t("Day {day}", { day })}{clanDays.includes(day) && <small>★ {t("Clan day")}</small>}
        </th>)}
        {header("on", t("On clan days"))}
        {header("other", t("Other days"))}
        {admin && <th>{t("Black mark")}</th>}
      </tr></thead>
      <tbody>{sorted.map((row) => <tr key={row.member?.id ?? `name:${row.name}`}>
        <td>{row.member
          ? <div className="table-member"><MemberAvatar member={row.member} small /><strong><MemberName member={row.member} /></strong></div>
          : <span className="war-guest">{row.name}</span>}</td>
        {row.days.map((value, index) => <td key={index} className={value && picked && !clanDays.includes(index + 1) ? "war-offday" : undefined}>
          {value === null ? "—" : numberFormat(value)}
        </td>)}
        <td className="war-points">{picked ? numberFormat(row.onClanDays) : "—"}</td>
        <td className={row.otherDays ? "war-offday" : undefined}>{picked ? numberFormat(row.otherDays) : "—"}</td>
        {admin && <td>{row.blackMark ? <span className="hoard-level hoard-level-high">{t("Black mark")}</span> : "—"}</td>}
      </tr>)}</tbody>
    </table></div>;
}
